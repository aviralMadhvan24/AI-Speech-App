import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
// Vite config:
// - Dev server runs on 5173 and proxies API requests to the FastAPI backend on 8000.
// - Production builds to ./dist which FastAPI then serves directly.
export default defineConfig({
    plugins: [react()],
    server: {
        port: 5173,
        proxy: {
            '/sessions': 'http://127.0.0.1:8000',
            '/modules': 'http://127.0.0.1:8000',
            '/precheck': 'http://127.0.0.1:8000',
        },
    },
    build: {
        outDir: 'dist',
        emptyOutDir: true,
    },
});
