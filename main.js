import { Actor, log } from 'apify';
import fetch from 'node-fetch';
import AdmZip from 'adm-zip';

const MEDIA_EXTENSIONS = [
    '.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.svg',
    '.mp4', '.mov', '.m4v', '.avi', '.webm', '.mp3', '.wav', '.mkv', '.flv', '.ogg',
];

const CONTENT_TYPE_EXTENSION_MAP = {
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/gif': '.gif',
    'image/webp': '.webp',
    'image/svg+xml': '.svg',
    'video/mp4': '.mp4',
    'video/webm': '.webm',
    'video/x-msvideo': '.avi',
    'audio/mpeg': '.mp3',
    'audio/wav': '.wav',
};

const client = Actor.newClient();

const toSlug = (value) => value?.toLowerCase()?.replace(/[^a-z0-9]+/g, '-')?.replace(/(^-|-$)/g, '') || 'brand';

const isMediaUrl = (value) => {
    if (typeof value !== 'string') return false;
    if (!value.startsWith('http')) return false;
    return MEDIA_EXTENSIONS.some((ext) => value.toLowerCase().includes(ext));
};

const extractMediaUrls = (data) => {
    const urls = new Set();

    const walker = (node) => {
        if (!node) return;
        if (typeof node === 'string') {
            if (isMediaUrl(node)) urls.add(node);
            return;
        }
        if (Array.isArray(node)) {
            for (const item of node) walker(item);
            return;
        }
        if (typeof node === 'object') {
            for (const value of Object.values(node)) walker(value);
        }
    };

    walker(data);
    return Array.from(urls);
};

const getDatasetItems = async (datasetId) => {
    if (!datasetId) return [];
    const dataset = await Actor.openDataset(datasetId);
    const items = [];
    let offset = 0;
    const limit = 1000;

    while (true) {
        const { items: pageItems, total, count } = await dataset.getData({ offset, limit });
        items.push(...pageItems);
        offset += count;
        if (items.length >= total || count === 0) break;
    }

    return items;
};

const safeExtension = (url, contentType) => {
    const lowerUrl = url.toLowerCase();
    const found = MEDIA_EXTENSIONS.find((ext) => lowerUrl.includes(ext));
    if (found) return found;
    if (contentType && CONTENT_TYPE_EXTENSION_MAP[contentType]) return CONTENT_TYPE_EXTENSION_MAP[contentType];
    return '.bin';
};

const downloadMediaToZip = async (urls, folderName, zip) => {
    let count = 0;
    const failed = [];

    for (const [index, url] of urls.entries()) {
        try {
            const response = await fetch(url);
            if (!response.ok) throw new Error(`Status ${response.status}`);
            const contentType = response.headers.get('content-type');
            const extension = safeExtension(url, contentType);
            const buffer = Buffer.from(await response.arrayBuffer());
            const filename = `${folderName}/${String(index + 1).padStart(5, '0')}${extension}`;
            zip.addFile(filename, buffer);
            count += 1;
        } catch (error) {
            log.warning(`Failed to download media from ${url}: ${error.message}`);
            failed.push({ url, reason: error.message });
        }
    }

    return { count, failed };
};

const downloadZipAssets = async (storeId, folderName, zip) => {
    if (!storeId) return { count: 0, failed: [] };

    let exclusiveStartKey;
    let count = 0;
    const failed = [];

    try {
        do {
            const { items = [], isTruncated, nextExclusiveStartKey } = await client.keyValueStores.listKeys({
                storeId,
                exclusiveStartKey,
                limit: 1000,
            });

            for (const item of items) {
                if (!item.key.toLowerCase().endsWith('.zip')) continue;
                try {
                    const record = await client.keyValueStores.getRecord({ storeId, key: item.key });
                    if (!record || !record.value) continue;

                    let buffer;
                    if (Buffer.isBuffer(record.value)) {
                        buffer = record.value;
                    } else if (record.value instanceof Uint8Array) {
                        buffer = Buffer.from(record.value);
                    } else if (typeof record.value === 'string') {
                        buffer = Buffer.from(record.value, 'base64');
                    }

                    if (!buffer) continue;
                    zip.addFile(`${folderName}/${item.key}`, buffer);
                    count += 1;
                } catch (error) {
                    log.warning(`Failed to merge zip ${item.key} from store ${storeId}: ${error.message}`);
                    failed.push({ key: item.key, reason: error.message });
                }
            }

            exclusiveStartKey = isTruncated ? nextExclusiveStartKey : undefined;
        } while (exclusiveStartKey);
    } catch (error) {
        log.warning(`Unable to list key-value store ${storeId}: ${error.message}`);
    }

    return { count, failed };
};

const runScraper = async ({ name, actorId, input, mediaFolder, maxMedia }) => {
    if (!input) {
        log.info(`Skipping ${name}: no input provided.`);
        return null;
    }

    log.info(`Running ${name} (${actorId})...`);
    const run = await Actor.call(actorId, input);

    const items = await getDatasetItems(run.defaultDatasetId);
    const mediaUrls = extractMediaUrls(items);
    const trimmedMediaUrls = maxMedia ? mediaUrls.slice(0, maxMedia) : mediaUrls;
    const zip = new AdmZip();
    const mediaDownload = await downloadMediaToZip(trimmedMediaUrls, mediaFolder, zip);
    const zipMerge = await downloadZipAssets(run.defaultKeyValueStoreId, `${mediaFolder}/archives`, zip);

    return {
        name,
        actorId,
        runId: run.id,
        datasetId: run.defaultDatasetId,
        keyValueStoreId: run.defaultKeyValueStoreId,
        datasetItems: items,
        media: { urls: trimmedMediaUrls, ...mediaDownload, mergedArchives: zipMerge.count, archiveFailures: zipMerge.failed },
        zip,
    };
};

const createKeywordQueries = (keywords) => {
    if (!keywords) return [];
    if (Array.isArray(keywords)) return keywords.filter(Boolean);
    if (typeof keywords === 'string') return keywords.split(',').map((k) => k.trim()).filter(Boolean);
    return [];
};

const getTikTokUsername = (url) => {
    if (!url) return null;
    const match = url.match(/tiktok\.com\/(?:@)?([A-Za-z0-9._-]+)/i);
    return match?.[1] || url.replace('@', '').trim();
};

await Actor.main(async () => {
    const input = (await Actor.getInput()) || {};
    const {
        brandName = 'Brand',
        instagram,
        facebook,
        tiktok,
        googleMaps,
        website,
        keywords,
    } = input;

    const brandSlug = toSlug(brandName || 'brand');
    const finalZip = new AdmZip();
    const results = {
        brandName,
        startedAt: new Date().toISOString(),
        scrapers: {},
    };

    const instagramResult = await runScraper({
        name: 'instagram',
        actorId: 'apify/instagram-scraper',
        mediaFolder: 'instagram',
        maxMedia: 500,
        input: instagram
            ? {
                  directUrls: [instagram],
                  resultsType: 'posts',
                  maxItemCount: 500,
                  latestPosts: 500,
                  includeStories: true,
                  includeHighlights: true,
                  downloadMedia: true,
              }
            : null,
    });

    const facebookResult = await runScraper({
        name: 'facebook',
        actorId: 'pocesar/facebook-page-scraper',
        mediaFolder: 'facebook',
        input: facebook
            ? {
                  startUrls: [{ url: facebook }],
                  resultsLimit: 500,
                  includeReviews: true,
                  downloadAttachments: true,
              }
            : null,
    });

    const tiktokUsername = getTikTokUsername(tiktok);
    const tiktokResult = await runScraper({
        name: 'tiktok',
        actorId: 'store/tiktok-scraper',
        mediaFolder: 'tiktok',
        input: tiktokUsername
            ? {
                  profiles: [tiktokUsername],
                  downloadVideos: true,
                  downloadCovers: true,
              }
            : null,
    });

    const googleMapsResult = await runScraper({
        name: 'googleMaps',
        actorId: 'apify/google-maps-scraper',
        mediaFolder: 'google-maps',
        input: googleMaps || brandName
            ? {
                  searchStringsArray: [googleMaps || brandName],
                  includeImages: true,
                  includeReviews: false,
                  maxCrawledPlacesPerSearch: 1,
              }
            : null,
    });

    const websiteResult = await runScraper({
        name: 'website',
        actorId: 'apify/website-content-crawler',
        mediaFolder: 'website',
        input: website
            ? {
                  startUrls: [{ url: website }],
                  crawlerType: 'cheerio-crawler',
                  maxDepth: 3,
                  includeUrlGlobs: ['.*'],
                  maxRequestRetries: 2,
                  downloadMedia: true,
              }
            : null,
    });

    const googleQueries = createKeywordQueries(keywords);
    const googleSearchResult = await runScraper({
        name: 'googleSearch',
        actorId: 'apify/google-search-scraper',
        mediaFolder: 'google-search',
        input: googleQueries.length
            ? {
                  queries: googleQueries,
                  maxPagesPerQuery: 1,
                  saveHtml: false,
              }
            : null,
    });

    const scraperResults = [instagramResult, facebookResult, tiktokResult, googleMapsResult, websiteResult, googleSearchResult].filter(Boolean);

    for (const result of scraperResults) {
        results.scrapers[result.name] = {
            actorId: result.actorId,
            runId: result.runId,
            datasetId: result.datasetId,
            keyValueStoreId: result.keyValueStoreId,
            itemCount: result.datasetItems.length,
            media: result.media,
        };

        if (result.datasetItems.length) {
            results.scrapers[result.name].items = result.datasetItems;
        }

        if (result.zip) {
            for (const entry of result.zip.getEntries()) {
                finalZip.addFile(entry.entryName, entry.getData());
            }
        }
    }

    results.completedAt = new Date().toISOString();
    results.totalMediaDownloaded = scraperResults.reduce((sum, r) => sum + (r.media?.count || 0), 0);

    await Actor.setValue('RESULT.json', results);
    const zipKey = `${brandSlug}_full_media.zip`;
    await Actor.setValue(zipKey, finalZip.toBuffer(), { contentType: 'application/zip' });

    log.info(`Stored structured result as RESULT.json with ${scraperResults.length} scraper sections.`);
    log.info(`Stored merged media zip as ${zipKey} including downloaded assets.`);
});
