-- Migration: adiciona ChannelProvider.META_INSTAGRAM_LOGIN para o novo
-- fluxo Instagram Business Login direto (OAuth redirect em instagram.com,
-- sem depender de Pagina do Facebook).
ALTER TYPE "ChannelProvider" ADD VALUE IF NOT EXISTS 'META_INSTAGRAM_LOGIN';
