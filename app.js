// Frontend bootstrap.
// Supabase connection will be added after the project is created and secured.
document.querySelectorAll('.bottom-nav button').forEach((button) => {
  button.addEventListener('click', () => {
    document.querySelectorAll('.bottom-nav button').forEach((item) => item.classList.remove('active'));
    button.classList.add('active');
  });
});