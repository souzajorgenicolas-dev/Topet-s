// Loads the latest active catalog for each new visit. Without Supabase setup,
// the original local menu remains available.
window.loadTopetsData = () => window.TopetsSupabase.loadPublicData(window.menu, window.config);
