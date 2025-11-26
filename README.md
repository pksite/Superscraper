# PKSite SuperScraper

PKSite SuperScraper is an Apify actor that collects media URLs from multiple sources into one unified dataset for a brand.

## Input
Provide a JSON object with optional fields:
- `brandName`
- `instagram`
- `facebook`
- `tiktok`
- `googleMaps`
- `website`

## Output
The actor writes one dataset where each item contains:
- `source` (`instagram` | `facebook` | `tiktok` | `googleMaps` | `website`)
- `type` (`image` | `video`)
- `mediaUrl`
- `postUrl`
- `caption`
- `takenAt`
- `extra`

It also saves a `RESULT` record in the key-value store with basic run metadata.

## Child actors used
- `apify/instagram-scraper`
- `apify/facebook-posts-scraper`
- `clockworks/tiktok-scraper`
- `compass/crawler-google-places`
- `apify/website-content-crawler`
