/* Public settings for the browser. Safe to publish: the anon key only allows what Row Level Security permits. */
window.TSHK_CONFIG = {
  SUPABASE_URL: "https://ytvqwdkwfexbqiiyztyg.supabase.co",
  SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl0dnF3ZGt3ZmV4YnFpaXl6dHlnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA3ODgwNDgsImV4cCI6MjEwNjM2NDA0OH0.dq61SGX3yjq4NeDj7ZBF0-i78LdOqNaFP1XgFjBq_jk",
  PRICE_LABEL: "R100",
  TRIAL_DAYS: 7,
  /* true for Google Play / App Store builds: hides the PayFast subscribe button inside the app
     (store rules require their own billing for digital subscriptions sold in the app). */
  STORE_BUILD: false
};
