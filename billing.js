/**
 * PAIEMENT PAR ABONNEMENT (STRIPE)
 * ---------------------------------------------------------------
 * Flux :
 *  1. Le client clique sur un abonnement (page Tarifs ou lien de l'e-mail)
 *  2. On crée une session Stripe Checkout (page de paiement hébergée par Stripe :
 *     c'est Stripe qui collecte et sécurise la carte, jamais votre serveur)
 *  3. Stripe appelle le webhook (/api/billing/webhook) => on active l'abonnement en base
 *  4. Chaque mois, Stripe prélève et appelle de nouveau le webhook => quota remis à zéro
 *
 * Routes :
 *  POST /api/billing/checkout       { plan }  => { url }   (nouvel abonnement OU changement de formule)
 *  POST /api/billing/portal                   => { url }   (gérer carte, factures, résiliation)
 *  GET  /api/billing/choose/:plan?t=JETON     (lien depuis l'e-mail : redirige vers Stripe)
 *  POST /api/billing/webhook                  (appelé par Stripe uniquement)
 *
 * Configuration Stripe nécessaire (voir README) :
 *  - 3 prix mensuels récurrents, SANS essai gratuit  => STRIPE_PRICE_*
 *  - un endpoint webhook avec ces événements :
 *      checkout.session.completed, invoice.payment_succeeded, invoice.payment_failed,
 *      customer.subscription.updated, customer.subscription.deleted
 *  - le Portail client activé (Paramètres > Facturation > Portail client)
 */
const express = require('express');
const jwt = require('jsonwebtoken');
const Stripe = require('stripe');
const config = require('./config');
const db = require('./db');
const mailer = require('./mailer');
const { requireAuth, HttpError } = require('./auth');

const stripe = config.stripe.secretKey ? new Stripe(config.stripe.secretKey) : null;
const router = express.Router();

const needStripe = () => { if (!stripe) throw new HttpError(503, 'Le paiement n\'est pas encore configuré (clé Stripe manquante).'); };

const planByPrice = (priceId) => Object.keys(config.plans).find((k) => config.plans[k].stripePriceId === priceId) || null;
const periodEndMs = (sub) => {
  const s = sub.current_period_end || (sub.items && sub.items.data[0] && sub.items.data[0].current_period_end);
  return s ? s * 1000 : null;
};
const ACTIVE = ['active', 'trialing', 'past_due'];

async function ensureCustomer(user) {
  if (user.stripe_customer_id) return user.stripe_customer_id;
  const c = await stripe.customers.create({ email: user.email, name: user.name, metadata: { user_id: user.id } });
  db.prepare('UPDATE users SET stripe_customer_id = ? WHERE id = ?').run(c.id, user.id);
  return c.id;
}

/** Crée la session de paiement, ou change de formule si un abonnement est déjà actif. */
async function startCheckout(user, planKey) {
  needStripe();
  const plan = config.plans[planKey];
  if (!plan) throw new HttpError(400, 'Formule inconnue.');
  if (!plan.stripePriceId) throw new HttpError(503, `Prix Stripe manquant pour la formule ${plan.name} (STRIPE_PRICE_${planKey.toUpperCase()}).`);

  // Déjà abonné : on change simplement le prix (au prorata) sans repasser par la page de paiement.
  if (user.stripe_subscription_id && ACTIVE.includes(user.sub_status)) {
    if (user.plan === planKey) throw new HttpError(400, 'Vous avez déjà cette formule.');
    const sub = await stripe.subscriptions.retrieve(user.stripe_subscription_id);
    await stripe.subscriptions.update(sub.id, {
      items: [{ id: sub.items.data[0].id, price: plan.stripePriceId }],
      proration_behavior: 'create_prorations',
      metadata: { user_id: user.id, plan: planKey },
    });
    db.prepare('UPDATE users SET plan = ? WHERE id = ?').run(planKey, user.id);
    return { url: `${config.baseUrl}/#/espace?changed=1` };
  }

  const customer = await ensureCustomer(user);
  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer,
    client_reference_id: user.id,
    line_items: [{ price: plan.stripePriceId, quantity: 1 }],
    locale: 'fr',
    // Pas de période d'essai : aucun "trial_period_days" ici, et aucun essai sur le prix Stripe.
    subscription_data: { metadata: { user_id: user.id, plan: planKey } },
    metadata: { user_id: user.id, plan: planKey },
    success_url: `${config.baseUrl}/#/espace?paid=1`,
    cancel_url: `${config.baseUrl}/#/tarifs`,
  });
  return { url: session.url };
}

async function cancelSubscriptionNow(user) {
  if (!stripe || !user.stripe_subscription_id) return;
  await stripe.subscriptions.cancel(user.stripe_subscription_id);
}

router.post('/checkout', requireAuth, async (req, res, next) => {
  try { res.json(await startCheckout(req.user, String(req.body.plan || ''))); } catch (e) { next(e); }
});

router.post('/portal', requireAuth, async (req, res, next) => {
  try {
    needStripe();
    if (!req.user.stripe_customer_id) throw new HttpError(400, 'Aucun abonnement à gérer.');
    const s = await stripe.billingPortal.sessions.create({ customer: req.user.stripe_customer_id, return_url: `${config.baseUrl}/#/parametres` });
    res.json({ url: s.url });
  } catch (e) { next(e); }
});

/** Lien cliqué depuis l'e-mail de confirmation : valide l'e-mail puis envoie vers la page de paiement. */
router.get('/choose/:plan', async (req, res) => {
  try {
    const { uid, purpose } = jwt.verify(String(req.query.t || ''), config.jwtSecret);
    if (purpose !== 'plan-link') throw new Error('bad token');
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(uid);
    if (!user) throw new Error('no user');
    db.prepare('UPDATE users SET email_verified = 1 WHERE id = ?').run(uid);
    if (user.plan && ACTIVE.includes(user.sub_status) && user.plan === req.params.plan) return res.redirect(`${config.baseUrl}/#/espace`);
    const { url } = await startCheckout(user, req.params.plan);
    res.redirect(url);
  } catch (e) {
    console.error('Lien abonnement :', e.message);
    res.redirect(`${config.baseUrl}/#/tarifs`);
  }
});

/* ------------------------------------------------------------------ */
/*  WEBHOOK STRIPE : attention, ce routeur reçoit le corps BRUT (voir server.js) */
/* ------------------------------------------------------------------ */
async function webhookHandler(req, res) {
  if (!stripe || !config.stripe.webhookSecret) return res.status(503).send('Webhook non configuré');
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature'], config.stripe.webhookSecret);
  } catch (err) {
    console.error('Signature webhook invalide :', err.message);
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
        const plan = (s.metadata && s.metadata.plan) || planByPrice(sub.items.data[0].price.id);
        db.prepare(`UPDATE users SET plan=?, stripe_customer_id=?, stripe_subscription_id=?, sub_status=?, used_minutes=0, period_end=?, email_verified=1 WHERE id=?`)
          .run(plan, s.customer, sub.id, sub.status, periodEndMs(sub), userId);
        const u = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
        if (u) mailer.sendPaymentOk(u, plan);
        break;
      }
      case 'invoice.payment_succeeded': {
        const inv = event.data.object;
        const u = findByCustomer(inv.customer);
        // Renouvellement mensuel => on remet le compteur de minutes à zéro.
        if (u && inv.billing_reason === 'subscription_cycle' && inv.subscription) {
          const sub = await stripe.subscriptions.retrieve(inv.subscription);
          db.prepare('UPDATE users SET used_minutes = 0, sub_status = ?, period_end = ? WHERE id = ?').run(sub.status, periodEndMs(sub), u.id);
        }
        break;
      }
      case 'invoice.payment_failed': {
        const u = findByCustomer(event.data.object.customer);
        if (u) { db.prepare("UPDATE users SET sub_status = 'past_due' WHERE id = ?").run(u.id); mailer.sendPaymentFailed(u); }
        break;
      }
      case 'customer.subscription.updated': {
        const sub = event.data.object;
        const u = findByCustomer(sub.customer);
        if (!u) break;
        const plan = planByPrice(sub.items.data[0].price.id) || u.plan;
        const alive = ACTIVE.includes(sub.status);
        db.prepare('UPDATE users SET plan=?, sub_status=?, stripe_subscription_id=?, period_end=? WHERE id=?')
          .run(alive ? plan : null, sub.status, sub.id, periodEndMs(sub), u.id);
        break;
      }
      case 'customer.subscription.deleted': {
        const u = findByCustomer(event.data.object.customer);
        if (u) db.prepare("UPDATE users SET plan=NULL, sub_status='canceled', stripe_subscription_id=NULL WHERE id=?").run(u.id);
        break;
      }
      default: break;
    }
    res.json({ received: true });
  } catch (err) {
    console.error('Erreur traitement webhook :', err);
    res.status(500).send('Erreur');
  }
}

module.exports = { router, webhookHandler, cancelSubscriptionNow };
