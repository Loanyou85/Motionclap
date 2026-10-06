/**
 * Informations légales de l'éditeur, utilisées par les mentions légales, les CGV
 * et la politique de confidentialité. À COMPLÉTER avant la mise en production,
 * et à faire relire par un professionnel du droit.
 */
export const LEGAL = {
  serviceName: 'Atelier Motion',
  siteUrl: '[URL du site — à compléter]',
  companyName: '[Raison sociale — à compléter]',
  legalForm: '[Forme juridique et capital social — à compléter]',
  address: '[Adresse du siège — à compléter]',
  registration: '[RCS / SIREN — à compléter]',
  vatNumber: '[Numéro de TVA intracommunautaire — à compléter]',
  publicationDirector: '[Directeur de la publication — à compléter]',
  contactEmail: '[contact@votre-domaine — à compléter]',
  privacyEmail: '[rgpd@votre-domaine — à compléter]',
  /** Hébergement de l'application web (Vercel, Netlify, OVHcloud…). */
  webHost: '[Hébergeur du site, adresse et téléphone — à compléter]',
  /** Région du projet Supabase (ex. « Union européenne — Francfort »). */
  supabaseRegion: '[Région du projet Supabase — à compléter]',
  /** Médiateur de la consommation (obligatoire pour les ventes aux consommateurs en France). */
  mediator: '[Nom et site du médiateur de la consommation — à compléter]',
  lastUpdate: '6 octobre 2026',
};

export const hasPlaceholders = () => Object.values(LEGAL).some((v) => v.includes('à compléter'));
