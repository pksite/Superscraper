import { Actor } from 'apify';

/**
 * Helper: run another Apify actor and return all items from its default dataset.
 */
async function runChildActor(actorId, input) {
    if (!actorId) return [];

    const run = await Actor.call(actorId, input || {});
    const datasetId = run.defaultDatasetId;
    if (!datasetId) return [];

    const dataset = await Actor.openDataset(datasetId);
    const { items } = await dataset.getData({ clean: true });
    return items || [];
}

/**
 * Normalize media item shape.
 */
function normalizeMedia({
    source,
    type,
    mediaUrl,
    postUrl,
    caption,
    takenAt,
    extra = {},
}) {
    if (!mediaUrl) return null;

    return {
        source,                 // 'instagram' | 'facebook' | 'tiktok' | 'googleMaps' | 'website'
        type,                   // 'image' | 'video'
        mediaUrl,
        postUrl: postUrl || null,
        caption: caption || null,
        takenAt: takenAt || null,
        extra,
    };
}

async function collectFromInstagram(instagramUrl, brandName) {
    if (!instagramUrl) return [];

    // apify/instagram-scraper – use direct profile URL, get posts with media
    const input = {
        directUrls: [instagramUrl],
        resultsType: 'posts',
        resultsLimit: 100,     // can tune later
        mediaTypes: ['IMAGE', 'VIDEO', 'CAROUSEL_ALBUM'],
        downloadImages: false,
        downloadVideos: false,
    };

    const rawItems = await runChildActor('apify/instagram-scraper', input);

    const normalized = [];

    for (const item of rawItems) {
        // Typical fields: item.displayResources, item.videoUrl, item.url, item.caption, item.takenAt
        if (Array.isArray(item.displayResources)) {
            for (const res of item.displayResources) {
                const m = normalizeMedia({
                    source: 'instagram',
                    type: 'image',
                    mediaUrl: res.src,
                    postUrl: item.url,
                    caption: item.caption,
                    takenAt: item.takenAt,
                    extra: { brandName, shortcode: item.shortcode },
                });
                if (m) normalized.push(m);
            }
        }

        if (item.videoUrl) {
            const m = normalizeMedia({
                source: 'instagram',
                type: 'video',
                mediaUrl: item.videoUrl,
                postUrl: item.url,
                caption: item.caption,
                takenAt: item.takenAt,
                extra: { brandName, shortcode: item.shortcode },
            });
            if (m) normalized.push(m);
        }
    }

    return normalized;
}

async function collectFromFacebook(facebookUrl, brandName) {
    if (!facebookUrl) return [];

    const input = {
        startUrls: [{ url: facebookUrl }],
        maxPosts: 100,
        includePostImages: true,
        includePostVideos: true,
    };

    const rawItems = await runChildActor('apify/facebook-posts-scraper', input);
    const normalized = [];

    for (const item of rawItems) {
        // Expect: item.postUrl, item.message, item.imageUrls, item.videoUrl, item.createdTime
        if (Array.isArray(item.imageUrls)) {
            for (const url of item.imageUrls) {
                const m = normalizeMedia({
                    source: 'facebook',
                    type: 'image',
                    mediaUrl: url,
                    postUrl: item.postUrl,
                    caption: item.message,
                    takenAt: item.createdTime,
                    extra: { brandName, id: item.id },
                });
                if (m) normalized.push(m);
            }
        }

        if (item.videoUrl) {
            const m = normalizeMedia({
                source: 'facebook',
                type: 'video',
                mediaUrl: item.videoUrl,
                postUrl: item.postUrl,
                caption: item.message,
                takenAt: item.createdTime,
                extra: { brandName, id: item.id },
            });
            if (m) normalized.push(m);
        }
    }

    return normalized;
}

async function collectFromTikTok(tiktokUrl, brandName) {
    if (!tiktokUrl) return [];

    const input = {
        startUrls: [tiktokUrl],
        maxItems: 100,
        downloadVideos: false,
    };

    const rawItems = await runChildActor('clockworks/tiktok-scraper', input);
    const normalized = [];

    for (const item of rawItems) {
        // Expect: item.webVideoUrl (or similar), item.coverImageUrl, item.text, item.createTime, item.shareUrl
        if (item.coverImageUrl) {
            const m = normalizeMedia({
                source: 'tiktok',
                type: 'image',
                mediaUrl: item.coverImageUrl,
                postUrl: item.shareUrl || item.webVideoUrl,
                caption: item.text,
                takenAt: item.createTime,
                extra: { brandName, id: item.id },
            });
            if (m) normalized.push(m);
        }

        if (item.webVideoUrl) {
            const m = normalizeMedia({
                source: 'tiktok',
                type: 'video',
                mediaUrl: item.webVideoUrl,
                postUrl: item.shareUrl || item.webVideoUrl,
                caption: item.text,
                takenAt: item.createTime,
                extra: { brandName, id: item.id },
            });
            if (m) normalized.push(m);
        }
    }

    return normalized;
}

async function collectFromGoogleMaps(googleMapsUrl, brandName) {
    if (!googleMapsUrl) return [];

    const input = {
        startUrls: [{ url: googleMapsUrl }],
        maxCrawledPlaces: 1,
        includeReviews: false,
        includeImages: true,
    };

    const rawItems = await runChildActor('compass/crawler-google-places', input);
    const normalized = [];

    for (const item of rawItems) {
        // Expect: item.photos (array of {url}), item.url or item.gmapsUrl
        if (Array.isArray(item.photos)) {
            for (const p of item.photos) {
                if (!p.url) continue;
                const m = normalizeMedia({
                    source: 'googleMaps',
                    type: 'image',
                    mediaUrl: p.url,
                    postUrl: item.gmapsUrl || item.url,
                    caption: item.title || item.name,
                    takenAt: null,
                    extra: { brandName, placeId: item.placeId },
                });
                if (m) normalized.push(m);
            }
        }
    }

    return normalized;
}

async function collectFromWebsite(websiteUrl, brandName) {
    if (!websiteUrl) return [];

    const input = {
        startUrls: [{ url: websiteUrl }],
        maxDepth: 2,
        maxPagesPerCrawl: 50,
        downloadMedia: false,
    };

    const rawItems = await runChildActor('apify/website-content-crawler', input);
    const normalized = [];

    for (const item of rawItems) {
        // Try to pull OG images, main images, etc.
        if (Array.isArray(item.images)) {
            for (const url of item.images) {
                const m = normalizeMedia({
                    source: 'website',
                    type: 'image',
                    mediaUrl: url,
                    postUrl: item.url,
                    caption: item.title,
                    takenAt: null,
                    extra: { brandName },
                });
                if (m) normalized.push(m);
            }
        }

        if (item.ogImage) {
            const m = normalizeMedia({
                source: 'website',
                type: 'image',
                mediaUrl: item.ogImage,
                postUrl: item.url,
                caption: item.title,
                takenAt: null,
                extra: { brandName, kind: 'og:image' },
            });
            if (m) normalized.push(m);
        }
    }

    return normalized;
}

Actor.main(async () => {
    const input = await Actor.getInput() || {};
    const {
        brandName = 'Unknown brand',
        instagram,
        facebook,
        tiktok,
        googleMaps,
        website,
    } = input;

    const allMedia = [];

    allMedia.push(...await collectFromInstagram(instagram, brandName));
    allMedia.push(...await collectFromFacebook(facebook, brandName));
    allMedia.push(...await collectFromTikTok(tiktok, brandName));
    allMedia.push(...await collectFromGoogleMaps(googleMaps, brandName));
    allMedia.push(...await collectFromWebsite(website, brandName));

    // Push to this actor's default dataset.
    for (const item of allMedia) {
        await Actor.pushData(item);
    }

    await Actor.setValue('RESULT', {
        brandName,
        totalMediaCount: allMedia.length,
        sourcesUsed: {
            instagram: Boolean(instagram),
            facebook: Boolean(facebook),
            tiktok: Boolean(tiktok),
            googleMaps: Boolean(googleMaps),
            website: Boolean(website),
        },
    });
});
