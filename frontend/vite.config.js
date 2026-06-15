import { defineConfig } from "vite";
import { resolve } from "path";

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        login: resolve(__dirname, "login.html"),
        dashboard: resolve(__dirname, "dashboard.html"),
        liveagent: resolve(__dirname, "liveagent.html"),
        chat: resolve(__dirname, "chat.html"),
        customer_profile: resolve(__dirname, "customer_profile.html"),
        memory_inspector: resolve(__dirname, "memory_inspector.html")
      }
    }
  }
});