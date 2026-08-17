import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Порт 5174 зашит намеренно: ровно он прописан в CORS_ORIGINS бэкенда.
// strictPort — чтобы Vite не уехал молча на 5175 и не упёрся в CORS.
//
// host: '127.0.0.1' — не косметика. По умолчанию Vite слушает только на ::1,
// и всё, что резолвит localhost в IPv4 (curl, часть браузеров и IDE-превью),
// получает «connection refused». Явный IPv4 снимает этот класс вопросов.
const server = { host: '127.0.0.1', port: 5174, strictPort: true } as const;

export default defineConfig({
  plugins: [react()],
  server,
  preview: server,
});
