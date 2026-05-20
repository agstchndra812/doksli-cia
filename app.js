document.addEventListener('DOMContentLoaded', () => {
    // Authentication
    const loginOverlay = document.getElementById('loginOverlay');
    const passwordInput = document.getElementById('passwordInput');
    const loginBtn = document.getElementById('loginBtn');
    const loginError = document.getElementById('loginError');

    const handleLogin = () => {
        if (passwordInput.value === 'adoel') {
            loginOverlay.classList.add('hidden');
            loginError.classList.add('hidden');
            // Hanya muat galeri jika password benar
            loadGallery();
        } else {
            loginError.classList.remove('hidden');
            // Kosongkan input password saat salah
            passwordInput.value = '';
            passwordInput.focus();
        }
    };

    loginBtn.addEventListener('click', handleLogin);
    passwordInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') handleLogin();
    });

    // DOM Elements
    const uploadBtn = document.getElementById('uploadBtn');
    const uploadModal = document.getElementById('uploadModal');
    const closeModalBtn = document.getElementById('closeModalBtn');
    const dropZone = document.getElementById('dropZone');
    const fileInput = document.getElementById('fileInput');
    const galleryGrid = document.getElementById('galleryGrid');
    const emptyState = document.getElementById('emptyState');
    
    // Filter State & Buttons
    const filterButtons = document.querySelectorAll('.filter-btn');
    let currentFilter = 'all';

    filterButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            filterButtons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentFilter = btn.getAttribute('data-filter');
            loadGallery();
        });
    });

    // Sort State & Element
    const sortSelect = document.getElementById('sortSelect');
    let currentSort = 'newest';

    sortSelect.addEventListener('change', (e) => {
        currentSort = e.target.value;
        loadGallery();
    });

    // Upload Status Elements
    const uploadStatus = document.getElementById('uploadStatus');
    const statusText = document.getElementById('statusText');
    const progressFill = document.getElementById('progressFill');

    // Lightbox Elements
    const lightbox = document.getElementById('lightbox');
    const closeLightboxBtn = document.getElementById('closeLightboxBtn');
    const lightboxImg = document.getElementById('lightboxImg');
    const lightboxVideo = document.getElementById('lightboxVideo');
    const lightboxCaption = document.getElementById('lightboxCaption');

    // Data awal tidak dimuat di sini, tapi saat login berhasil

    // Modal Events
    uploadBtn.addEventListener('click', () => uploadModal.classList.remove('hidden'));
    closeModalBtn.addEventListener('click', () => {
        uploadModal.classList.add('hidden');
        resetUploadUI();
    });

    // Lightbox Events
    closeLightboxBtn.addEventListener('click', closeLightbox);
    lightbox.addEventListener('click', (e) => {
        if (e.target === lightbox || e.target.classList.contains('lightbox-content')) {
            closeLightbox();
        }
    });

    // Drag and Drop Events
    dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.classList.add('dragover');
    });
    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('dragover');
        if (e.dataTransfer.files.length) handleFiles(e.dataTransfer.files);
    });
    dropZone.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', (e) => {
        if (e.target.files.length) handleFiles(e.target.files);
    });

    function resetUploadUI() {
        uploadStatus.classList.add('hidden');
        progressFill.style.width = '0%';
        dropZone.style.display = 'block';
        fileInput.value = '';
    }

    async function handleFiles(files) {
        dropZone.style.display = 'none';
        uploadStatus.classList.remove('hidden');
        
        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            const percent = Math.round((i / files.length) * 100);
            updateProgress(`Memproses ${file.name}...`, percent);

            try {
                let processedFile = file;
                let type = file.type.startsWith('video/') ? 'video' : 'image';

                if (type === 'image') {
                    // Kompresi Gambar menggunakan browser-image-compression (kualitas dioptimalkan tetap tajam)
                    const options = {
                        maxSizeMB: CONFIG.maxImageSizeMB,
                        maxWidthOrHeight: 2560, // Resolusi tinggi 2K
                        useWebWorker: true,
                        initialQuality: 0.85 // Sweet-spot kompresi vs kualitas (85% tajam)
                    };
                    processedFile = await imageCompression(file, options);
                } else {
                    // Video: Validasi ukuran dan simpan langsung
                    if (file.size / 1024 / 1024 > CONFIG.maxVideoSizeMB) {
                        alert(`Video ${file.name} terlalu besar. Maks ${CONFIG.maxVideoSizeMB}MB.`);
                        continue;
                    }
                }

                // Simpan ke database (IndexedDB atau Supabase)
                const mediaItem = {
                    id: Date.now().toString() + Math.random().toString(36).substring(2, 9),
                    name: file.name,
                    type: type,
                    file: processedFile, // Dibutuhkan oleh Supabase
                    data: CONFIG.provider === 'local' ? await fileToBase64(processedFile) : null, // Hanya isi base64 jika lokal
                    size: processedFile.size,
                    timestamp: Date.now()
                };

                await saveMedia(mediaItem);

            } catch (error) {
                console.error("Error processing file:", error);
                alert(`Gagal memproses ${file.name}`);
            }
        }

        updateProgress('Selesai!', 100);
        setTimeout(() => {
            uploadModal.classList.add('hidden');
            resetUploadUI();
            loadGallery();
        }, 1000);
    }

    function updateProgress(text, percent) {
        statusText.innerText = text;
        progressFill.style.width = `${percent}%`;
    }

    function fileToBase64(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.readAsDataURL(file);
            reader.onload = () => resolve(reader.result);
            reader.onerror = error => reject(error);
        });
    }

    function updateStorageIndicator(mediaItems) {
        const totalBytes = mediaItems.reduce((acc, item) => acc + (item.size || 0), 0);
        const totalMB = totalBytes / (1024 * 1024);
        
        // Batas kapasitas total: jika supabase = 1024MB (1GB), jika local = 500MB
        const maxMB = CONFIG.provider === 'supabase' ? 1024 : 500;
        const percentage = Math.min((totalMB / maxMB) * 100, 100);
        
        const storageFill = document.getElementById('storageFill');
        const storageText = document.getElementById('storageText');
        
        if (storageFill && storageText) {
            storageFill.style.width = `${percentage}%`;
            storageText.innerText = `${totalMB.toFixed(1)} MB / ${maxMB} MB`;
            
            // Ubah warna bar jika penyimpanan hampir penuh
            if (percentage > 90) {
                storageFill.style.background = 'linear-gradient(90deg, #ef4444, #f97316)'; // Merah/Oranye
            } else if (percentage > 70) {
                storageFill.style.background = 'linear-gradient(90deg, #f59e0b, #ef4444)'; // Kuning/Merah
            } else {
                storageFill.style.background = 'linear-gradient(90deg, #10b981, #3b82f6)'; // Hijau/Biru
            }
        }
    }

    async function loadGallery() {
        const media = await getAllMedia();
        updateStorageIndicator(media);
        
        // Filter media sesuai tab aktif (all, image, video)
        const filteredMedia = currentFilter === 'all' 
            ? media 
            : media.filter(item => item.type === currentFilter);

        // Sortir media (terbaru / terlama) berdasarkan timestamp
        if (currentSort === 'newest') {
            filteredMedia.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
        } else {
            filteredMedia.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
        }

        galleryGrid.innerHTML = '';
        
        if (filteredMedia.length === 0) {
            emptyState.classList.remove('hidden');
            galleryGrid.classList.add('hidden');
            
            // Kustomisasi teks empty state
            const emptyTitle = document.querySelector('#emptyState h2');
            const emptyText = document.querySelector('#emptyState p');
            if (media.length === 0) {
                emptyTitle.innerText = "Kosong co";
                emptyText.innerText = "Masukin doksli cia njime.";
            } else {
                emptyTitle.innerText = "Tidak ditemukan";
                if (currentFilter === 'image') {
                    emptyText.innerText = "Tidak ada doksli foto di sini.";
                } else {
                    emptyText.innerText = "Tidak ada doksli video di sini.";
                }
            }
        } else {
            emptyState.classList.add('hidden');
            galleryGrid.classList.remove('hidden');
            
            filteredMedia.forEach(item => {
                const card = document.createElement('div');
                card.className = 'media-card';
                card.onclick = () => openLightbox(item);

                let mediaElement;
                if (item.type === 'video') {
                    mediaElement = `<video src="${item.data}" preload="metadata" muted></video>`;
                } else {
                    mediaElement = `<img src="${item.data}" alt="${item.name}" loading="lazy">`;
                }

                const sizeMB = (item.size / (1024 * 1024)).toFixed(2);
                
                // Format tanggal upload
                const uploadDate = item.timestamp ? new Date(item.timestamp).toLocaleDateString('id-ID', {
                    day: 'numeric',
                    month: 'short',
                    year: 'numeric'
                }) : 'Tidak ada tanggal';
                
                // Badge penanda Foto / Video
                const badgeHTML = item.type === 'video'
                    ? `<span class="media-badge badge-video"><i class="fa-solid fa-video"></i> Video</span>`
                    : `<span class="media-badge badge-image"><i class="fa-solid fa-image"></i> Foto</span>`;
                
                card.innerHTML = `
                    ${mediaElement}
                    ${badgeHTML}
                    <div class="media-overlay">
                        <div class="media-actions">
                            <button class="btn-icon" onclick="event.stopPropagation(); downloadItem('${item.data}', '${item.name}')">
                                <i class="fa-solid fa-download"></i>
                            </button>
                            <button class="btn-icon" onclick="event.stopPropagation(); deleteItem('${item.id}')">
                                <i class="fa-solid fa-trash"></i>
                            </button>
                        </div>
                        <div class="media-info">
                            ${item.name}
                            <span>${sizeMB} MB • ${uploadDate}</span>
                        </div>
                    </div>
                `;
                galleryGrid.appendChild(card);
            });
        }
    }

    window.deleteItem = async (id) => {
        if (confirm('Apakah Anda yakin ingin menghapus media ini?')) {
            await deleteMedia(id);
            loadGallery();
        }
    };

    window.downloadItem = async (dataUrl, filename) => {
        try {
            let url = dataUrl;
            // Jika link online, unduh sebagai blob terlebih dahulu untuk memaksa unduhan di browser
            if (dataUrl.startsWith('http')) {
                const response = await fetch(dataUrl);
                const blob = await response.blob();
                url = URL.createObjectURL(blob);
            }
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            
            // Bersihkan objek URL setelah selesai
            if (dataUrl.startsWith('http')) {
                URL.revokeObjectURL(url);
            }
        } catch (error) {
            console.error("Gagal mengunduh file:", error);
            // Fallback: buka di tab baru jika fetch diblokir (misal CORS)
            window.open(dataUrl, '_blank');
        }
    };

    function openLightbox(item) {
        lightbox.classList.remove('hidden');
        
        const sizeMB = (item.size / (1024 * 1024)).toFixed(2);
        const uploadDate = item.timestamp ? new Date(item.timestamp).toLocaleDateString('id-ID', {
            day: 'numeric',
            month: 'long',
            year: 'numeric'
        }) : 'Tidak ada tanggal';
        
        lightboxCaption.innerHTML = `${item.name} <span class="lightbox-meta">${sizeMB} MB • ${uploadDate}</span>`;

        if (item.type === 'video') {
            lightboxImg.classList.add('hidden');
            lightboxVideo.classList.remove('hidden');
            lightboxVideo.src = item.data;
            lightboxVideo.play().catch(e => console.log("Auto-play prevented", e));
        } else {
            lightboxVideo.classList.add('hidden');
            lightboxImg.classList.remove('hidden');
            lightboxImg.src = item.data;
            lightboxVideo.pause();
            lightboxVideo.src = "";
        }
        document.body.style.overflow = 'hidden';
    }

    function closeLightbox() {
        lightbox.classList.add('hidden');
        lightboxVideo.pause();
        lightboxVideo.src = "";
        lightboxImg.src = "";
        document.body.style.overflow = 'auto';
    }
});
