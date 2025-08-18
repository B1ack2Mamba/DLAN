/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',        // статический экспорт (в папку out)
  trailingSlash: true,     // страницы как .../index.html (важно для IPFS)
  assetPrefix: './',       // относительные пути к ассетам _next/…
  images: { unoptimized: true }, // чтобы не было /_next/image (не работает на IPFS)
};

module.exports = nextConfig;
