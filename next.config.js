/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    optimizeCss: false,
    css: false
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