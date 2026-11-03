# Teks GitHub

Gunakan untuk teks yang tampil atau dibaca orang di GitHub: deskripsi repo,
README, issue, pull request, release notes, dan Discussions. Untuk instruksi
agent atau dokumentasi perilaku skill, gunakan [instruksi skill](instruksi-skill.md)
dan pertahankan aturan teknisnya.

## Brief lanjutan

Perjelas artefak GitHub, pembaca, tujuan, tahap proyek, bahasa, dan bagian yang
harus dipertahankan. README perlu menjawab apa proyeknya, untuk siapa, cara mulai,
dan batas yang perlu diketahui. Deskripsi repo perlu satu kalimat yang mudah
dipindai. Issue perlu memisahkan masalah, konteks, langkah reproduksi, dan hasil
yang diharapkan. PR perlu menjelaskan perubahan, alasan, dampak, dan pemeriksaan.
Release notes perlu menyebut perubahan yang relevan bagi pengguna dan tindakan
migrasi bila ada.

## Menulis

Pertahankan nama paket, perintah, path, API, versi, status, dan contoh kode persis
kecuali pengguna meminta perubahan teknis. Jangan mengubah copy menjadi klaim
fitur yang belum ada. Pisahkan teks untuk pembaca dari catatan maintainer atau
instruksi reviewer. Pilih struktur sesuai artefak, bukan satu template untuk
semua halaman GitHub.

Gunakan kalimat langsung dan istilah yang bisa dicari pembaca. Hindari jargon
promosi seperti "revolusioner" tanpa bukti. Untuk issue dan PR, keterlacakan lebih
penting daripada suara unik. Untuk README dan deskripsi repo, pembaca perlu segera
memahami kegunaan dan langkah berikutnya. Jangan menambahkan badge, statistik,
testimonial, atau status rilis tanpa bahan.

## Pemeriksaan

Cek bahwa tautan, command, nama file, versi, dan status tidak berubah makna.
Pastikan judul dan pembuka menjelaskan artefak yang benar. Issue/PR harus bisa
dipahami tanpa catatan percakapan internal. Release notes tidak boleh menyiratkan
perubahan yang tidak ada di diff atau bahan yang diberikan.
