// Local Storage Management menggunakan IndexedDB atau Supabase
const DB_NAME = 'DoksliCiaDB';
const STORE_NAME = 'media';
const DB_VERSION = 1;

let dbInstance = null;

// Inisialisasi Supabase Client jika provider diset ke 'supabase'
let supabaseClient = null;
const BUCKET_NAME = 'doksli-media';

if (CONFIG.provider === 'supabase') {
    if (typeof supabase !== 'undefined') {
        supabaseClient = supabase.createClient(CONFIG.supabaseUrl, CONFIG.supabaseKey);
    } else {
        console.error("Supabase library belum dimuat. Pastikan index.html memuat SDK Supabase.");
    }
}

const initDB = () => {
    return new Promise((resolve, reject) => {
        if (dbInstance) {
            resolve(dbInstance);
            return;
        }
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        
        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME, { keyPath: 'id' });
            }
        };

        request.onsuccess = (event) => {
            dbInstance = event.target.result;
            resolve(dbInstance);
        };

        request.onerror = (event) => reject(event.target.error);
    });
};

const saveMedia = async (mediaData) => {
    if (CONFIG.provider === 'supabase') {
        if (!supabaseClient) throw new Error("Supabase client belum terinisialisasi.");

        // mediaData memiliki: { id, name, type, file, size, timestamp }
        // Kita upload file-nya ke Supabase Storage terlebih dahulu
        const fileExt = mediaData.name.split('.').pop();
        // Beri nama unik di storage menggunakan id agar aman dari bentrokan nama
        const storagePath = `${mediaData.id}.${fileExt}`;

        let lastError = null;
        const maxRetries = 3;

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                // 1. Upload ke Storage
                const { data: uploadData, error: uploadError } = await supabaseClient.storage
                    .from(BUCKET_NAME)
                    .upload(storagePath, mediaData.file, {
                        contentType: mediaData.file.type,
                        upsert: false
                    });

                if (uploadError) {
                    throw uploadError;
                }

                // 2. Dapatkan Public URL
                const { data: publicUrlData } = supabaseClient.storage
                    .from(BUCKET_NAME)
                    .getPublicUrl(storagePath);

                const publicUrl = publicUrlData.publicUrl;

                // 3. Simpan metadata ke tabel 'media'
                const { error: insertError } = await supabaseClient
                    .from('media')
                    .insert({
                        id: mediaData.id,
                        name: mediaData.name,
                        type: mediaData.type,
                        data: publicUrl, // Di galeri, data digunakan langsung sebagai src
                        size: mediaData.size,
                        timestamp: mediaData.timestamp,
                        storage_path: storagePath
                    });

                if (insertError) {
                    // Rollback upload jika insert data gagal
                    await supabaseClient.storage.from(BUCKET_NAME).remove([storagePath]);
                    throw insertError;
                }

                return mediaData.id; // Sukses, langsung keluar dari fungsi
            } catch (error) {
                lastError = error;
                console.warn(`[Supabase Upload] Percobaan ke-${attempt} gagal. Mencoba kembali...`, error);
                
                // Jika masih ada sisa percobaan, tunggu delay sebelum mencoba kembali
                if (attempt < maxRetries) {
                    // Tunggu delay (2 detik, 4 detik, dst.)
                    await new Promise(resolve => setTimeout(resolve, 2000 * attempt));
                }
            }
        }

        // Jika semua percobaan gagal, lempar error terakhir
        console.error("Error upload file ke Supabase Storage setelah retry:", lastError);
        throw lastError;
    } else {
        // Logika IndexedDB (Local)
        const db = await initDB();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([STORE_NAME], 'readwrite');
            const store = transaction.objectStore(STORE_NAME);
            
            // Kita hapus object file agar tidak disimpan di IndexedDB (IndexedDB hanya butuh base64 'data')
            const itemToSave = { ...mediaData };
            delete itemToSave.file;

            const request = store.add(itemToSave);
            request.onsuccess = () => resolve(mediaData.id);
            request.onerror = () => reject(request.error);
        });
    }
};

const getAllMedia = async () => {
    if (CONFIG.provider === 'supabase') {
        if (!supabaseClient) throw new Error("Supabase client belum terinisialisasi.");
        
        const { data, error } = await supabaseClient
            .from('media')
            .select('*')
            .order('timestamp', { ascending: false });

        if (error) {
            console.error("Error fetch media dari Supabase:", error);
            throw error;
        }
        return data;
    } else {
        // Logika IndexedDB
        const db = await initDB();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([STORE_NAME], 'readonly');
            const store = transaction.objectStore(STORE_NAME);
            const request = store.getAll();
            request.onsuccess = () => resolve(request.result.sort((a, b) => b.timestamp - a.timestamp));
            request.onerror = () => reject(request.error);
        });
    }
};

const deleteMedia = async (id) => {
    if (CONFIG.provider === 'supabase') {
        if (!supabaseClient) throw new Error("Supabase client belum terinisialisasi.");

        // 1. Ambil info file untuk mencari storage_path
        const { data, error: fetchError } = await supabaseClient
            .from('media')
            .select('storage_path')
            .eq('id', id)
            .single();

        if (fetchError) {
            console.error("Error mencari media untuk dihapus:", fetchError);
            throw fetchError;
        }

        const storagePath = data.storage_path;

        // 2. Hapus file dari Supabase Storage
        const { error: deleteStorageError } = await supabaseClient.storage
            .from(BUCKET_NAME)
            .remove([storagePath]);

        if (deleteStorageError) {
            console.warn("Peringatan: Gagal menghapus file di Storage, tetap menghapus data di DB...", deleteStorageError);
        }

        // 3. Hapus baris data dari database
        const { error: deleteDbError } = await supabaseClient
            .from('media')
            .delete()
            .eq('id', id);

        if (deleteDbError) {
            console.error("Error menghapus metadata dari database:", deleteDbError);
            throw deleteDbError;
        }

        return true;
    } else {
        // Logika IndexedDB
        const db = await initDB();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([STORE_NAME], 'readwrite');
            const store = transaction.objectStore(STORE_NAME);
            const request = store.delete(id);
            request.onsuccess = () => resolve(true);
            request.onerror = () => reject(request.error);
        });
    }
};
