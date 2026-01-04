/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    optimizeCss: false   // Disable LightningCSS for Linux builds
  },

  serverExternalPackages: ['swisseph'],

  typescript: {
    ignoreBuildErrors: true
  },

  eslint: {
    ignoreDuringBuilds: true
  },

  webpack: (config) => {
    config.externals.push({
      swisseph: 'commonjs swisseph'
    });
    return config;
  }
};

module.exports = nextConfig;