// =====================================================================
// CashG — imagekit-auth Edge Function
//
// Gives a signed-in, active user a short-lived ImageKit upload signature
// so the app can upload their payment receipt straight to ImageKit.
// The ImageKit private key stays here and never reaches the browser.
//
// Secrets:  supabase secrets set IMAGEKIT_PRIVATE_KEY=private_...
// Deploy:   supabase functions deploy imagekit-auth --no-verify-jwt
//           (the function verifies the caller's token itself)
// =====================================================================

import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// ImageKit accepts expiry up to 1 hour ahead; keep it short
const SIGNATURE_TTL_SECONDS = 10 * 60;

function json(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
}

async function hmacSha1Hex(key: string, message: string) {
    const cryptoKey = await crypto.subtle.importKey(
        'raw', new TextEncoder().encode(key), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign'],
    );
    const signature = await crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(message));
    return Array.from(new Uint8Array(signature)).map(b => b.toString(16).padStart(2, '0')).join('');
}

Deno.serve(async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
    if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

    const url = Deno.env.get('SUPABASE_URL');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const privateKey = Deno.env.get('IMAGEKIT_PRIVATE_KEY')?.trim().replace(/^["']|["']$/g, '');
    if (!url || !serviceKey) return json({ error: 'Function is missing its Supabase keys.' }, 500);
    if (!privateKey) return json({ error: 'Receipt uploads are not set up yet (IMAGEKIT_PRIVATE_KEY).' }, 500);

    if (!privateKey.startsWith('private_')) {
        return json({ error: 'IMAGEKIT_PRIVATE_KEY is not a private key (it must start with "private_"). Re-enter it in Supabase secrets.' }, 500);
    }

    const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

    // Only signed-in users with an active account may upload
    const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
    if (!token) return json({ error: 'Please sign in again.' }, 401);

    const { data: userData, error: userError } = await admin.auth.getUser(token);
    if (userError || !userData?.user) return json({ error: 'Please sign in again.' }, 401);

    const { data: profile } = await admin
        .from('profiles').select('status').eq('id', userData.user.id).maybeSingle();
    if (profile?.status !== 'active') return json({ error: 'This account is disabled.' }, 403);

    const uploadToken = crypto.randomUUID();
    const expire = Math.floor(Date.now() / 1000) + SIGNATURE_TTL_SECONDS;
    const signature = await hmacSha1Hex(privateKey, uploadToken + expire);

    return json({
        token: uploadToken,
        expire,
        signature,
        folder: `/cashg/receipts/${userData.user.id}`,
    });
});
