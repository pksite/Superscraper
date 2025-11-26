# PKSite SuperScraper

PKSite SuperScraper is an Apify actor that collects media, articles, and business information for a single brand across multiple sources in one run. The actor orchestrates Instagram, Facebook, TikTok, Google Maps, a website crawler, and Google Search scrapers, downloads all media, merges every archive into a single ZIP, and stores a unified JSON summary.

## How it works
1. Accepts a single JSON input describing the brand and source URLs/usernames.
2. Launches the downstream Apify actors with sensible defaults (500 Instagram posts, website depth 3, etc.).
3. Aggregates all dataset outputs, extracts media links, downloads the media, and merges any ZIP assets exposed by child actors.
4. Produces two final artifacts in the default key-value store:
   - `RESULT.json` — structured data and metadata for every scraper run.
   - `{brandName}_full_media.zip` — merged archive containing all downloaded images/videos and any ZIP files from child scrapers.

## Input
Provide a single JSON object:

```json
{
  "brandName": "PKSite",
  "instagram": "https://www.instagram.com/example/",
  "facebook": "https://www.facebook.com/example",
  "tiktok": "https://www.tiktok.com/@example",
  "googleMaps": "Example Business, London",
  "website": "https://www.example.com",
  "keywords": "example brand, press coverage"
}
```

**Fields**
- `brandName` (string, required): Display name used for labeling artifacts.
- `instagram` (string, optional): Profile URL for `apify/instagram-scraper` (posts, stories, highlights, media download capped at 500 posts).
- `facebook` (string, optional): Page URL for `pocesar/facebook-page-scraper` (profile/cover photos, posts, attachments).
- `tiktok` (string, optional): TikTok profile URL or handle used by `store/tiktok-scraper` (videos and covers downloaded).
- `googleMaps` (string, optional): Place query or Google Maps URL used by `compass/google-maps-scraper` (place info and photos).
- `website` (string, optional): Root URL for `apify/website-content-crawler` (articles, images, titles, content, maxDepth 3).
- `keywords` (string | array, optional): Terms passed to `apify/google-search-scraper` to collect top article URLs.

## Output
Two final records are stored in the default key-value store:
- `RESULT.json`: Contains per-scraper run IDs, dataset IDs, item counts, media download stats, and full dataset items when available.
- `<brandName>_full_media.zip`: Combined archive of all downloaded media plus any ZIP files found in child actor key-value stores.

## Included scrapers
- **Instagram** — `apify/instagram-scraper` with posts (max 500), stories, highlights, media download.
- **Facebook Page** — `pocesar/facebook-page-scraper` with profile media, posts, and attachments.
- **TikTok** — `store/tiktok-scraper` with username extraction from the provided URL or handle.
- **Google Maps** — `compass/google-maps-scraper` to gather photos and place details.
- **Website Content** — `apify/website-content-crawler` limited to depth 3 for articles, titles, content, and images.
- **Google Search** — `apify/google-search-scraper` using provided `keywords` to collect top article links.

## Running locally or on Apify
1. Install dependencies: `npm install`.
2. Run the actor locally: `npm start` (ensure `APIFY_TOKEN` is set if calling cloud actors).
3. Deploy to Apify: push the repository to Apify or use `apify push`.

The actor uses ES modules, `Actor.call()` to orchestrate downstream scrapers, and stores the merged outputs so it can run directly on the Apify platform after Git import.
