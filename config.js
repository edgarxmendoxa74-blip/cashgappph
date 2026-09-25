// =====================================================================
// CashG — connection settings (shared by the app and the admin site)
//
// Supabase → Project Settings → API Keys:
//   supabaseUrl     = Project URL
//   supabaseAnonKey = Publishable key (sb_publishable_…) or legacy "anon public" key
//
// This key is safe to publish: every table is protected by the
// row-level security rules in supabase/schema.sql.
// NEVER put a secret key (sb_secret_…) or the service_role key here.
// =====================================================================

window.CASHG_CONFIG = {
    supabaseUrl: 'https://htvemsqubwxqoeakfjbs.supabase.co',
    supabaseAnonKey: 'sb_publishable_QHBV2N6hdCXzktwa-ShbwA_QJxmVaq0'
};
