// The Vercel function. Vercel decides which files are functions before the build command runs, so this file has to be
// committed; the real app is bundled into ../dist-vercel/index.js by `npm run build:vercel` and loaded from here.
export { default } from "../dist-vercel/index.js";
