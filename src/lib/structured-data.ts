import { CAMPAIGN, CONTACT, OG } from "@/content/campaign";
import { SOCIAL_LINKS } from "@/content/project";
import { SITE_URL } from "@/lib/metadata";

/**
 * Schema.org structured data, as plain objects.
 *
 * Built here rather than inline in a page so that the church's identity is
 * described once. Two of these three refer to the organisation, and a search
 * engine should be told they mean the same organisation rather than three
 * similar ones, which is what the @id below is for.
 *
 * Every value is read from src/content, so the JSON-LD and the visible page
 * cannot drift apart. Nothing here is a money total: totals come from the
 * database and are not something to restate in markup that a crawler may cache
 * for weeks.
 */

/*
 * The stable identifier for the church, used by every schema on the site.
 *
 * A fragment on the main church site rather than on this subdomain, because the
 * organisation being described is the church itself, which has existed a good
 * deal longer than this pledge platform and will outlast it. This subdomain
 * describes the campaign; it does not own the church's identity.
 */
const ORGANISATION_ID = `${CONTACT.siteUrl}/#organization`;

const WEBSITE_ID = `${SITE_URL}/#website`;

/**
 * The church.
 *
 * Typed as Church, which is a schema.org subtype of Organization by way of
 * LocalBusiness and PlaceOfWorship, so this is an Organization with the extra
 * fields a place of worship actually has. Consumers that only understand
 * Organization still read it as one.
 */
export function organizationSchema() {
  return {
    "@context": "https://schema.org",
    "@type": "Church",
    "@id": ORGANISATION_ID,
    name: CONTACT.churchName,
    alternateName: "Newlife Seventh-day Adventist Church",
    url: CONTACT.siteUrl,
    logo: `${SITE_URL}/images/logo/adventist-en-centered--bluejay.png`,
    image: `${SITE_URL}${OG.image}`,
    email: CONTACT.email,
    telephone: "+254722619788",
    address: {
      "@type": "PostalAddress",
      streetAddress: "5th Ngong Avenue",
      addressLocality: "Nairobi",
      addressCountry: "KE",
    },
    /*
     * The church's own accounts, plus the main church site.
     *
     * sameAs is how a search engine works out that this subdomain, the
     * WordPress site and four social accounts are one body rather than six.
     * This site's own URL is not listed: a page does not need to tell a
     * crawler it is itself.
     */
    sameAs: [CONTACT.siteUrl, ...SOCIAL_LINKS.map((social) => social.href)],
  };
}

/** This site, as distinct from the church that runs it. */
export function websiteSchema() {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    "@id": WEBSITE_ID,
    name: CAMPAIGN.name,
    alternateName: CAMPAIGN.shortName,
    url: `${SITE_URL}/`,
    description: OG.description,
    inLanguage: "en",
    publisher: { "@id": ORGANISATION_ID },
  };
}

/**
 * The pledge form.
 *
 * DonateAction is the closest schema.org has, and the wording of the
 * description is careful for the same reason the confirmation page is: what
 * happens on /pledge is a promise to give, not a payment. Nothing is charged
 * and no card or M-Pesa prompt is involved, so the description says so rather
 * than letting a rich result imply a checkout.
 */
export function donateActionSchema() {
  return {
    "@context": "https://schema.org",
    "@type": "DonateAction",
    name: "Make a pledge",
    description:
      "Record a pledge toward the Crystal Fountain Development Project. A pledge is a promise to give, not a payment.",
    recipient: { "@id": ORGANISATION_ID },
    target: {
      "@type": "EntryPoint",
      urlTemplate: `${SITE_URL}/pledge`,
      actionPlatform: [
        "https://schema.org/DesktopWebPlatform",
        "https://schema.org/MobileWebPlatform",
      ],
    },
  };
}
