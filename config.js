// Konfigurasi Aplikasi Doksli Cia
const CONFIG = {
    // Opsi provider: 'local' (IndexedDB, tersimpan di browser masing-masing)
    // atau 'supabase' (tersimpan di cloud database, tersinkronisasi online)
    provider: "supabase", 

    // Kredensial Supabase (Wajib diisi jika menggunakan provider 'supabase')
    supabaseUrl: "https://kiktoknwoexsuubbqjcy.supabase.co",
    supabaseKey: "sb_publishable_4aVLWoYLVbfIgaS8uz8_zQ_FW6yRStQ",

    maxImageSizeMB: 2, // Ukuran maksimal gambar setelah kompresi
    maxVideoSizeMB: 500, // Batas upload video ditingkatkan menjadi 500MB
};
