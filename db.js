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

const saveMedia = async (mediaData, onProgress) => {
    if (CONFIG.provider === 'supabase') {
        if (!supabaseClient) throw new Error("Supabase client belum terinisialisasi.");

        const fileExt = mediaData.name.split('.').pop();
        const storagePath = `${mediaData.id}.${fileExt}`;

        const maxRetries = 3;
        let lastError = null;

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                // Upload menggunakan XHR agar mendukung progress real-time & timeout dinamis
                await uploadViaXHR(mediaData.file, storagePath, onProgress);

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
                        data: publicUrl,
                        size: mediaData.size,
                        timestamp: mediaData.timestamp,
                        storage_path: storagePath
                    });

                if (insertError) {
                    await supabaseClient.storage.from(BUCKET_NAME).remove([storagePath]);
                    throw insertError;
                }

                return mediaData.id;
            } catch (error) {
                lastError = error;
                console.warn(`[Upload] Percobaan ke-${attempt} gagal. Mencoba kembali...`, error);
                if (attempt < maxRetries) {
                    // Reset progress ke 0 sebelum retry
                    if (onProgress) onProgress(0);
                    await new Promise(resolve => setTimeout(resolve, 3000 * attempt));
                }
            }
        }

        console.error("Upload gagal setelah semua percobaan:", lastError);
        throw lastError;

    } else {
        // Logika IndexedDB (Local)
        const db = await initDB();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([STORE_NAME], 'readwrite');
            const store = transaction.objectStore(STORE_NAME);
            
            const itemToSave = { ...mediaData };
            delete itemToSave.file;

            const request = store.add(itemToSave);
            request.onsuccess = () => resolve(mediaData.id);
            request.onerror = () => reject(request.error);
        });
    }
};

// Upload file via XHR langsung ke Supabase Storage API
// Mendukung progress real-time dan timeout dinamis sesuai ukuran file
function uploadViaXHR(file, storagePath, onProgress) {
    return new Promise((resolve, reject) => {
        const url = `${CONFIG.supabaseUrl}/storage/v1/object/${BUCKET_NAME}/${storagePath}`;
        
        // Timeout tetap 30 menit — cukup untuk file besar apapun di koneksi lambat sekalipun
        const timeoutMs = 30 * 60 * 1000; // 30 menit

        const xhr = new XMLHttpRequest();
        xhr.open('POST', url, true);
        xhr.timeout = timeoutMs;

        // Header autentikasi Supabase
        xhr.setRequestHeader('Authorization', `Bearer ${CONFIG.supabaseKey}`);
        xhr.setRequestHeader('x-upsert', 'false');
        // Content-Type dihandle otomatis oleh browser saat pakai FormData/Blob

        // Progress tracking real-time
        xhr.upload.addEventListener('progress', (e) => {
            if (e.lengthComputable && onProgress) {
                const percent = Math.round((e.loaded / e.total) * 100);
                onProgress(percent);
            }
        });

        xhr.addEventListener('load', () => {
            if (xhr.status >= 200 && xhr.status < 300) {
                resolve(JSON.parse(xhr.responseText));
            } else {
                reject(new Error(`Upload gagal: ${xhr.status} ${xhr.responseText}`));
            }
        });

        xhr.addEventListener('timeout', () => {
            reject(new Error('Upload timeout setelah 30 menit. Koneksi terlalu lambat atau file terlalu besar. Coba lagi.'));
        });

        xhr.addEventListener('error', () => {
            reject(new Error('Koneksi terputus saat upload. Periksa internet Anda.'));
        });

        xhr.addEventListener('abort', () => {
            reject(new Error('Upload dibatalkan.'));
        });

        // Kirim file langsung sebagai binary (lebih efisien daripada FormData untuk file besar)
        xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
        xhr.send(file);
    });
}

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
