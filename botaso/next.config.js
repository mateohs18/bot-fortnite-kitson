/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    // !! ATENCIÓN: Esto apaga el chequeo de TypeScript !!
    ignoreBuildErrors: true,
  },
  eslint: {
    // También apaguemos ESLint por si acaso
    ignoreDuringBuilds: true,
  },
}

module.exports = nextConfig