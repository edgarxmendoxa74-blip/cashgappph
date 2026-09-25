// =====================================================================
// CashG — admin-users Edge Function
//
// Account actions that need the Supabase service-role key, which must
// never be shipped to a browser. Only signed-in admins may call it.
//
// Deploy:  supabase functions deploy admin-users --no-verify-jwt
//          (the function verifies the caller's token and admin role itself)
// Actions: create | set_password | set_status | delete
// =====================================================================

import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
}

Deno.serve(async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
    if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

    const url = Deno.env.get('SUPABASE_URL');
    // Supabase provides this automatically to every Edge Function
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!url || !serviceKey) return json({ error: 'Function is missing its Supabase keys.' }, 500);

    const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

    // 1. Who is calling? Verify their access token, then check their role.
    const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
    if (!token) return json({ error: 'Please sign in again.' }, 401);

    const { data: userData, error: userError } = await admin.auth.getUser(token);
    if (userError || !userData?.user) return json({ error: 'Please sign in again.' }, 401);

    const { data: callerProfile } = await admin
        .from('profiles').select('role, status').eq('id', userData.user.id).maybeSingle();
    if (callerProfile?.role !== 'admin' || callerProfile?.status !== 'active') {
        return json({ error: 'Admins only.' }, 403);
    }

    // 2. Caller is an admin: do the privileged work with the service-role client.

    let body: Record<string, unknown>;
    try {
        body = await req.json();
    } catch {
        return json({ error: 'Invalid request body.' }, 400);
    }

    const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

    try {
        switch (body.action) {
            case 'create': {
                const email = str(body.email).toLowerCase();
                const password = str(body.password);
                if (!email || !email.includes('@')) return json({ error: 'Enter a valid email address.' }, 400);
                if (password.length < 8) return json({ error: 'Password must be at least 8 characters.' }, 400);

                const { data, error } = await admin.auth.admin.createUser({
                    email,
                    password,
                    email_confirm: true,
                    user_metadata: {
                        full_name: str(body.full_name),
                        phone: str(body.phone),
                        business_name: str(body.business_name),
                    },
                });
                if (error) return json({ error: error.message }, 400);
                return json({ user_id: data.user.id });
            }

            case 'set_password': {
                const userId = str(body.user_id);
                const password = str(body.password);
                if (!userId) return json({ error: 'Missing user.' }, 400);
                if (password.length < 8) return json({ error: 'Password must be at least 8 characters.' }, 400);

                const { error } = await admin.auth.admin.updateUserById(userId, { password });
                if (error) return json({ error: error.message }, 400);
                return json({ ok: true });
            }

            case 'set_status': {
                const userId = str(body.user_id);
                const status = str(body.status);
                if (!userId || !['active', 'disabled'].includes(status)) return json({ error: 'Invalid status.' }, 400);
                if (userId === userData.user.id) return json({ error: 'You cannot disable your own account.' }, 400);

                // Banning blocks sign-in and token refresh; profile status lets the app react immediately.
                const { error: banError } = await admin.auth.admin.updateUserById(userId, {
                    ban_duration: status === 'disabled' ? '876000h' : 'none',
                });
                if (banError) return json({ error: banError.message }, 400);

                const { error } = await admin.from('profiles').update({ status }).eq('id', userId);
                if (error) return json({ error: error.message }, 400);
                return json({ ok: true });
            }

            case 'delete': {
                const userId = str(body.user_id);
                if (!userId) return json({ error: 'Missing user.' }, 400);
                if (userId === userData.user.id) return json({ error: 'You cannot delete your own account.' }, 400);

                const { error } = await admin.auth.admin.deleteUser(userId);
                if (error) return json({ error: error.message }, 400);
                return json({ ok: true });
            }

            default:
                return json({ error: 'Unknown action.' }, 400);
        }
    } catch (err) {
        return json({ error: err instanceof Error ? err.message : 'Unexpected error.' }, 500);
    }
});
