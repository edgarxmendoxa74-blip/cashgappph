// =====================================================================
// CashGee — account & subscription data (Supabase)
//
// Everything the app needs from the server goes through `Cloud`.
// Inventory records (transactions, customers, balances) stay on the
// device; only login, subscription and notifications live here.
// =====================================================================

const Cloud = (() => {
    const cfg = window.CASHG_CONFIG || {};
    const isConfigured = Boolean(
        cfg.supabaseUrl && cfg.supabaseAnonKey &&
        !cfg.supabaseUrl.includes('YOUR-PROJECT') && !cfg.supabaseAnonKey.includes('YOUR-')
    );

    const client = isConfigured && window.supabase
        ? window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
            auth: { persistSession: true, autoRefreshToken: true, storageKey: 'cashg-auth' }
        })
        : null;

    const PROOF_BUCKET = 'payment-proofs';

    function unwrap({ data, error }) {
        if (error) throw error;
        return data;
    }

    function friendlyError(error) {
        const message = error?.message || String(error || '');
        if (/invalid login credentials/i.test(message)) return 'Wrong email or password.';
        if (/banned|disabled/i.test(message)) return 'This account is disabled. Please contact the admin.';
        if (/failed to fetch|network|load failed/i.test(message)) return 'No internet connection. Please try again.';
        if (/subscription_requests_one_pending|duplicate key/i.test(message)) return 'You already have a payment waiting for review.';
        return message || 'Something went wrong. Please try again.';
    }

    // Signed upload: the imagekit-auth Edge Function holds the private key
    async function uploadToImageKit(blob, fileName) {
        const { data: auth, error } = await client.functions.invoke('imagekit-auth', { method: 'POST' });
        if (error) {
            const body = await error.context?.json?.().catch(() => null);
            throw new Error(body?.error || 'Could not prepare the receipt upload. Please try again.');
        }

        const body = new FormData();
        body.append('file', blob, fileName);
        body.append('fileName', fileName);
        body.append('publicKey', cfg.imagekitPublicKey);
        body.append('signature', auth.signature);
        body.append('expire', String(auth.expire));
        body.append('token', auth.token);
        body.append('folder', auth.folder);
        body.append('useUniqueFileName', 'true');

        const response = await fetch('https://upload.imagekit.io/api/v1/files/upload', { method: 'POST', body });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || !result.url) {
            throw new Error(result.message || 'Receipt upload failed. Please try again.');
        }
        return result.url;
    }

    // ImageKit URLs can be resized and optimised on the fly with ?tr=...
    function imageUrl(url, { width = 900, quality = 80 } = {}) {
        if (!url || !/^https:\/\/ik\.imagekit\.io\//.test(url)) return url;
        const transform = `tr=w-${width},q-${quality},f-auto`;
        return url + (url.includes('?') ? '&' : '?') + transform;
    }

    return {
        imageUrl,

        // True when a transaction receipt can go to ImageKit right now
        canUploadReceipts() {
            return Boolean(client && cfg.imagekitPublicKey && navigator.onLine);
        },

        uploadReceipt: (blob, fileName) => uploadToImageKit(blob, fileName),

        // config.js filled in
        hasConfig: isConfigured,
        // config filled in AND the Supabase library loaded (needs internet the first time)
        isReady: Boolean(client),
        friendlyError,

        // { session, error }. An expired token that can't be refreshed offline
        // comes back as a network error while the saved session is kept.
        async getSession() {
            if (!client) return { session: null, error: null };
            const { data, error } = await client.auth.getSession();
            return { session: data?.session || null, error: error || null };
        },

        isNetworkError(error) {
            if (!error) return false;
            return error.name === 'AuthRetryableFetchError' || error.status === 0 ||
                /failed to fetch|network|load failed|fetch failed/i.test(error.message || '');
        },

        async signIn(email, password) {
            const data = unwrap(await client.auth.signInWithPassword({ email, password }));
            return data.user;
        },

        async signOut() {
            if (client) await client.auth.signOut();
        },

        onSignedOut(callback) {
            if (!client) return;
            client.auth.onAuthStateChange(event => {
                if (event === 'SIGNED_OUT') callback();
            });
        },

        // Profile, subscription, prices, requests and notifications in one go
        async loadAccount(userId) {
            const [profile, subscriptions, settings, requests, notifications] = await Promise.all([
                client.from('profiles').select('*').eq('id', userId).maybeSingle().then(unwrap),
                client.from('subscriptions').select('*').eq('user_id', userId)
                    .order('ends_at', { ascending: false }).limit(20).then(unwrap),
                client.from('app_settings').select('*').eq('id', 1).maybeSingle().then(unwrap),
                client.from('subscription_requests').select('*').eq('user_id', userId)
                    .order('created_at', { ascending: false }).limit(20).then(unwrap),
                client.from('notifications').select('*').eq('user_id', userId)
                    .order('created_at', { ascending: false }).limit(50).then(unwrap)
            ]);
            return { profile, subscriptions: subscriptions || [], settings, requests: requests || [], notifications: notifications || [] };
        },

        // Receipt PNG → ImageKit when configured, otherwise the private Supabase bucket
        async submitSubscriptionRequest(userId, form, receiptBlob) {
            const fileName = `${form.receiptNo}.png`;
            let receiptUrl = null;
            let proofPath = null;

            // ImageKit first. If it isn't set up (or fails), keep the receipt in the
            // private Supabase bucket instead so Send Receipt still works.
            if (cfg.imagekitPublicKey) {
                try {
                    receiptUrl = await uploadToImageKit(receiptBlob, fileName);
                } catch (error) {
                    console.warn('ImageKit upload failed, using Supabase Storage instead', error);
                }
            }
            if (!receiptUrl) {
                proofPath = `${userId}/${fileName}`;
                unwrap(await client.storage.from(PROOF_BUCKET).upload(proofPath, receiptBlob, {
                    contentType: 'image/png',
                    upsert: false
                }));
            }

            return unwrap(await client.from('subscription_requests').insert({
                user_id: userId,
                plan: form.plan,
                full_name: form.fullName,
                phone: form.phone,
                business_name: form.businessName,
                address: form.address,
                payment_method: form.method,
                sender_name: form.senderName,
                sender_account: form.senderAccount,
                sender_bank: form.senderBank,
                payment_reference: form.reference,
                receipt_no: form.receiptNo,
                receipt_url: receiptUrl,
                proof_path: proofPath
            }).select().single());
        },

        async updateProfile({ fullName, phone, businessName }) {
            unwrap(await client.rpc('update_my_profile', {
                p_full_name: fullName,
                p_phone: phone,
                p_business_name: businessName
            }));
        },

        async markNotificationsRead() {
            unwrap(await client.rpc('mark_notifications_read', { p_ids: null }));
        }
    };
})();
