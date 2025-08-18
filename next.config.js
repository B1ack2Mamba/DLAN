/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',        // ����������� ������� (� ����� out)
  trailingSlash: true,     // �������� ��� .../index.html (����� ��� IPFS)
  assetPrefix: './',       // ������������� ���� � ������� _next/�
  images: { unoptimized: true }, // ����� �� ���� /_next/image (�� �������� �� IPFS)
};

module.exports = nextConfig;
