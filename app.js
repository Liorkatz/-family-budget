const { supabaseUrl, supabasePublishableKey } = window.FAMILY_BUDGET_CONFIG;
const supabaseClient = window.supabase.createClient(supabaseUrl, supabasePublishableKey);

document.querySelectorAll('.bottom-nav button').forEach((button) => {
  button.addEventListener('click', () => {
    document.querySelectorAll('.bottom-nav button').forEach((item) => item.classList.remove('active'));
    button.classList.add('active');
  });
});

async function checkBackend() {
  const { error } = await supabaseClient.from('transactions').select('id').limit(1);
  document.documentElement.dataset.backend = error ? 'locked' : 'ready';
}
checkBackend();
