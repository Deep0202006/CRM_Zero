const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
    console.error('❌ Missing required environment variables: SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY must be configured.');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey);

const ADMIN_EMAIL = 'admin@zerodata.com';
const ADMIN_PASSWORD = 'ZeroData@2026'; 

async function seedProductionEnvironment() {
    console.log('🚀 Starting secure administrative seed process...');

    try {
        const { data: existingAdmin, error: checkError } = await supabase
            .from('users')
            .select('user_id')
            .eq('email', ADMIN_EMAIL)
            .maybeSingle();

        if (checkError) throw checkError;
        if (existingAdmin) {
            console.log('⚠️ System administrator profile already instantiated. Skipping seed workflow...');
            return;
        }

        // 1. Create Core Authentication Layer Identity
        const { data: authUser, error: authError } = await supabase.auth.admin.createUser({
            email: ADMIN_EMAIL,
            password: ADMIN_PASSWORD,
            email_confirm: true,
            user_metadata: { 
                name: 'System Administrator',
                role: 'admin'
            }
        });

        if (authError) throw authError;
        const userId = authUser.user.id;

        // 2. Map Database User Record Mirror
        const { error: userError } = await supabase
            .from('users')
            .insert({
                user_id: userId,
                email: ADMIN_EMAIL,
                name: 'System Administrator',
                created_at: new Date().toISOString()
            });

        if (userError) throw userError;

        // 3. Allocate Administrative System Clearances
        const { error: capError } = await supabase
            .from('user_capabilities')
            .insert([
                { user_id: userId, capability_code: 'admin' },
                { user_id: userId, capability_code: 'dist_onboarding' },
                { user_id: userId, capability_code: 'tech_support' }
            ]);

        if (capError) throw capError;

        console.log('✅ Base system administrator profile provisioned successfully.');
        console.log(`   Target Email: ${ADMIN_EMAIL}`);
        console.log('   ⚠️ FORCE USER PASSWORD ENFORCEMENT ON FIRST SYSTEM ENTRY!');

    } catch (error) {
        console.error('❌ Production database initialization sequence failed:', error.message);
        process.exit(1);
    }
}

seedProductionEnvironment();
