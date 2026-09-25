// =====================================================================
// CashG — account & subscription data (Supabase)
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

    return {
        // config.js filled in
        hasConfig: isConfigured,
        // config filled in AND the Supabase library loaded (needs internet the first time)
        isReady: Boolean(client),
        friendlyError,

        async getSession() {
            if (!client) return null;
            const { data } = await client.auth.getSession();
            return data?.session || null;
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

        async submitSubscriptionRequest(userId, form, proofFile) {
            const ext = (proofFile.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
            const path = `${userId}/${Date.now()}.${ext}`;

            unwrap(await client.storage.from(PROOF_BUCKET).upload(path, proofFile, {
                contentType: proofFile.type || 'image/jpeg',
                upsert: false
            }));

            return unwrap(await client.from('subscription_requests').insert({
                user_id: userId,
                plan: form.plan,
                full_name: form.fullName,
                phone: form.phone,
                business_name: form.businessName,
                address: form.address,
                payment_reference: form.reference,
                proof_path: path
            }).select().single());
        },

        async markNotificationsRead() {
            unwrap(await client.rpc('mark_notifications_read', { p_ids: null }));
        }
    };
})();
