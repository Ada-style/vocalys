/**
 * PAIEMENT PAR ABONNEMENT (AGRÉGATEUR PRINCIPAL : SASPAY - Mobile Money & Cartes)
 * ---------------------------------------------------------------
 * Flux SasPay :
 *  1. Le client clique sur un abonnement (Starter, Pro, Business).
 *  2. Vocalys appelle l'API SasPay (/api/v1/checkout-sessions/) pour créer une session.
 *  3. Le client est redirigé vers la page sécurisée SasPay où il choisit son moyen :
 *     - Mobile Money (Wave, Orange Money, MTN MoMo, Moov Money)
 *     - Carte bancaire (Visa, Mastercard)
 *  4. SasPay notifie le webhook (/api/billing/webhook) avec signature HMAC-SHA256.
 *  5. Vocalys valide le compte pour 30 jours (period_end) et remet le quota à zéro.
 *
 * Rétrocompatibilité : si Stripe est configuré et pas SasPay, Stripe reste supporté.
 */
const express = require('express');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const Stripe = require('stripe');
const config = require('./config');
const db = require('./db');
const mailer = require('./mailer');
const { requireAuth, HttpError } = require('./auth');

const stripe = config.stripe.secretKey ? new Stripe(config.stripe.secretKey) : null;
const router = express.Router();

const isSasPay = () => !!config.saspay.apiKey;
const isStripe = () => !!stripe;
const ACTIVE = ['active', 'trialing', 'past_due'];

/** Démarre la session de paiement Checkout (SasPay par défaut, sinon Stripe) */
async function startCheckout(user, planKey) {
  const plan = config.plans[planKey];
  if (!plan) throw new HttpError(400, 'Formule inconnue.');

  // 1. Priorité à SasPay (Agrégateur Mobile Money + Cartes)
  if (isSasPay()) {
    const amount = plan.priceFcfa || Math.round(plan.priceEur * 655.957);
    const payload = {
      amount: String(amount),
      currency: config.saspay.currency || 'XOF',
      description: `Abonnement Vocalys ${plan.name} (1 mois)`,
      customer_email: user.email,
      customer_name: user.name,
      return_url: `${config.baseUrl}/#/espace?paid=1`,
      metadata: {
        user_id: user.id,
        plan: planKey,
      },
    };

    const res = await fetch(`${config.saspay.baseUrl}/api/v1/checkout-sessions/`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.saspay.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.error('Erreur SasPay API :', data);
      throw new HttpError(502, data.message || data.detail || 'Erreur lors de la création de la session de paiement SasPay.');
    }

    const checkoutUrl = data.checkout_url || data.url || (data.data && data.data.checkout_url);
    if (!checkoutUrl) throw new HttpError(502, 'Lien de paiement non reçu de SasPay.');
    return { url: checkoutUrl };
  }

  // 2. Alternative Stripe (si configuré)
  if (isStripe()) {
    if (!plan.stripePriceId) throw new HttpError(503, `Prix Stripe manquant pour ${plan.name}.`);
    let customerId = user.stripe_customer_id;
    if (!customerId) {
      const c = await stripe.customers.create({ email: user.email, name: user.name, metadata: { user_id: user.id } });
      customerId = c.id;
      db.prepare('UPDATE users SET stripe_customer_id = ? WHERE id = ?').run(c.id, user.id);
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      client_reference_id: user.id,
      line_items: [{ price: plan.stripePriceId, quantity: 1 }],
      locale: 'fr',
      subscription_data: { metadata: { user_id: user.id, plan: planKey } },
      metadata: { user_id: user.id, plan: planKey },
      success_url: `${config.baseUrl}/#/espace?paid=1`,
      cancel_url: `${config.baseUrl}/#/tarifs`,
    });
    return { url: session.url };
  }

  throw new HttpError(503, 'Le paiement n\'est pas encore configuré (clé SASPAY_API_KEY manquante dans .env).');
}

/** Portail de facturation (Stripe si utilisé) */
router.post('/portal', requireAuth, async (req, res, next) => {
  try {
    if (isStripe() && req.user.stripe_customer_id) {
      const s = await stripe.billingPortal.sessions.create({
        customer: req.user.stripe_customer_id,
        return_url: `${config.baseUrl}/#/parametres`,
      });
      return res.json({ url: s.url });
    }
    // Pour SasPay : les reçus et paiements sont gérés directement par factures/notifications
    res.json({ url: `${config.baseUrl}/#/tarifs` });
  } catch (e) { next(e); }
});

router.post('/checkout', requireAuth, async (req, res, next) => {
  try {
    res.json(await startCheckout(req.user, String(req.body.plan || '')));
  } catch (e) { next(e); }
});

/** Lien cliqué depuis l'e-mail de confirmation */
router.get('/choose/:plan', async (req, res) => {
  try {
    const { uid, purpose } = jwt.verify(String(req.query.t || ''), config.jwtSecret);
    if (purpose !== 'plan-link') throw new Error('Jeton invalide');
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(uid);
    if (!user) throw new Error('Utilisateur introuvable');
    db.prepare('UPDATE users SET email_verified = 1 WHERE id = ?').run(uid);
    const { url } = await startCheckout(user, req.params.plan);
    res.redirect(url);
  } catch (e) {
    console.error('Lien abonnement :', e.message);
    res.redirect(`${config.baseUrl}/#/tarifs`);
  }
});

/* ------------------------------------------------------------------ */
/*  WEBHOOK CENTRAL (SasPay & Stripe)                                  */
/* ------------------------------------------------------------------ */
async function webhookHandler(req, res) {
  const saspaySig = req.headers['x-webhook-signature'];
  const stripeSig = req.headers['stripe-signature'];
  const rawBody = req.body instanceof Buffer ? req.body.toString('utf8') : JSON.stringify(req.body);

  // 1. TRAITEMENT SASPAY (X-Webhook-Signature)
  if (saspaySig && config.saspay.webhookSecret) {
    const timestamp = req.headers['x-webhook-timestamp'] || '';
    // Vérification de la signature HMAC-SHA256 : sha256(secret, `${timestamp}.${rawBody}`)
    const expected = crypto.createHmac('sha256', config.saspay.webhookSecret)
      .update(`${timestamp}.${rawBody}`)
      .digest('hex');

    const valid = (saspaySig.toLowerCase() === expected.toLowerCase());
    if (!valid) {
      console.error('Signature SasPay invalide !');
      return res.status(400).send('Signature SasPay invalide');
    }

    try {
      const payload = JSON.parse(rawBody);
      const event = req.headers['x-webhook-event'] || payload.event || payload.type;
      
      // Événement de transaction réussie
      if (event === 'transaction.success' || event === 'checkout.completed' || payload.status === 'SUCCESSFUL') {
        const meta = payload.metadata || (payload.data && payload.data.metadata) || {};
        const userId = meta.user_id || payload.client_reference_id;
        const planKey = meta.plan || 'starter';

        let user = userId ? db.prepare('SELECT * FROM users WHERE id = ?').get(userId) : null;
        if (!user && payload.customer_email) {
          user = db.prepare('SELECT * FROM users WHERE email = ?').get(payload.customer_email.toLowerCase());
        }

        if (user) {
          const periodEnd = Date.now() + 30 * 24 * 3600 * 1000; // 30 jours
          db.prepare(`UPDATE users SET plan = ?, sub_status = 'active', used_minutes = 0, period_end = ?, email_verified = 1 WHERE id = ?`)
            .run(planKey, periodEnd, user.id);
          const updated = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
          mailer.sendPaymentOk(updated, planKey);
          console.log(`[SasPay] Abonnement activé avec succès pour ${user.email} (Formule: ${planKey})`);
        }
      }

      return res.json({ received: true });
    } catch (err) {
      console.error('Erreur traitement webhook SasPay :', err);
      return res.status(500).send('Erreur interne');
    }
  }

  // 2. TRAITEMENT STRIPE (stripe-signature)
  if (stripeSig && stripe && config.stripe.webhookSecret) {
    let event;
    try {
      event = stripe.webhooks.constructEvent(req.body, stripeSig, config.stripe.webhookSecret);
    } catch (err) {
      console.error('Signature Stripe invalide :', err.message);
      return res.status(400).send('Signature invalide');
    }

    try {
      const findByCustomer = (id) => db.prepare('SELECT * FROM users WHERE stripe_customer_id = ?').get(id);

      switch (event.type) {
        case 'checkout.session.completed': {
          const s = event.data.object;
          if (s.mode !== 'subscription') break;
          const userId = s.client_reference_id || (s.metadata && s.metadata.user_id);
          const sub = await stripe.subscriptions.retrieve(s.subscription);
          const plan = (s.metadata && s.metadata.plan) || Object.keys(config.plans).find(k => config.plans[k].stripePriceId === sub.items.data[0].price.id);
          const periodEnd = sub.current_period_end ? sub.current_period_end * 1000 : Date.now() + 30 * 86400000;
          db.prepare(`UPDATE users SET plan=?, stripe_customer_id=?, stripe_subscription_id=?, sub_status=?, used_minutes=0, period_end=?, email_verified=1 WHERE id=?`)
            .run(plan, s.customer, sub.id, sub.status, periodEnd, userId);
          const u = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
          if (u) mailer.sendPaymentOk(u, plan);
          break;
        }
        case 'invoice.payment_succeeded': {
          const inv = event.data.object;
          const u = findByCustomer(inv.customer);
          if (u && inv.billing_reason === 'subscription_cycle') {
            db.prepare('UPDATE users SET used_minutes = 0, sub_status = "active" WHERE id = ?').run(u.id);
          }
          break;
        }
        case 'customer.subscription.deleted': {
          const u = findByCustomer(event.data.object.customer);
          if (u) db.prepare("UPDATE users SET plan=NULL, sub_status='canceled', stripe_subscription_id=NULL WHERE id=?").run(u.id);
          break;
        }
      }
      return res.json({ received: true });
    } catch (err) {
      console.error('Erreur webhook Stripe :', err);
      return res.status(500).send('Erreur');
    }
  }

  // Si ni SasPay ni Stripe
  res.status(200).json({ received: true, note: 'Aucun processeur actif pour ce webhook' });
}

async function cancelSubscriptionNow(user) {
  if (stripe && user.stripe_subscription_id) {
    await stripe.subscriptions.cancel(user.stripe_subscription_id).catch(() => {});
  }
}

module.exports = { router, webhookHandler, cancelSubscriptionNow };
