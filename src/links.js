/**
 * Outbound links, in one place so there is one line to change.
 *
 * The footer link hides itself if SPONSOR is ever returned to a placeholder,
 * so a half-configured build ships without a broken link rather than with one.
 */
export const SPONSOR = 'https://buymeacoffee.com/adi.shukla41';
export const SITE = 'https://stockscanner.pages.dev';

export const sponsorConfigured = () => !SPONSOR.includes('YOUR_USERNAME');
