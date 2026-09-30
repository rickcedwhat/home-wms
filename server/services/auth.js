/**
 * Oracle NetSuite Token-Based Authentication (TBA) Service
 * 
 * Implements RFC 5849 OAuth 1.0a HMAC-SHA256 signature generation & header validation,
 * which RF-SMART middleware uses to securely invoke NetSuite RESTlets.
 */

import crypto from 'node:crypto';

export const TBA_CONFIG = {
  realm: 'RF_SMART_WMS_DEMO',
  consumerKey: 'ns_ck_984f72a1e09c841',
  consumerSecret: 'ns_cs_44bf8319e78a221f7c02b',
  tokenId: 'ns_tok_33d81b99a014e',
  tokenSecret: 'ns_ts_11a84f09d8e7b3c2'
};

function percentEncode(str) {
  return encodeURIComponent(str)
    .replace(/!/g, '%21')
    .replace(/\*/g, '%2A')
    .replace(/'/g, '%27')
    .replace(/\(/g, '%28')
    .replace(/\)/g, '%29');
}

/**
 * Generates an OAuth 1.0a HMAC-SHA256 Authorization Header for NetSuite RESTlet requests.
 */
export function generateTBAHeader(httpMethod, requestUrl, additionalParams = {}) {
  const nonce = crypto.randomBytes(16).toString('hex');
  const timestamp = Math.floor(Date.now() / 1000).toString();

  const oauthParams = {
    oauth_consumer_key: TBA_CONFIG.consumerKey,
    oauth_nonce: nonce,
    oauth_signature_method: 'HMAC-SHA256',
    oauth_timestamp: timestamp,
    oauth_token: TBA_CONFIG.tokenId,
    oauth_version: '1.0'
  };

  // Combine query params and oauth params (excluding realm and signature)
  const combined = { ...oauthParams, ...additionalParams };
  const sortedKeys = Object.keys(combined).sort();

  const parameterString = sortedKeys
    .map(key => `${percentEncode(key)}=${percentEncode(String(combined[key]))}`)
    .join('&');

  const normalizedUrl = requestUrl.split('?')[0];
  const signatureBaseString = `${httpMethod.toUpperCase()}&${percentEncode(normalizedUrl)}&${percentEncode(parameterString)}`;
  const signingKey = `${percentEncode(TBA_CONFIG.consumerSecret)}&${percentEncode(TBA_CONFIG.tokenSecret)}`;

  const signature = crypto
    .createHmac('sha256', signingKey)
    .update(signatureBaseString)
    .digest('base64');

  const headerValue = `OAuth ` +
    `realm="${percentEncode(TBA_CONFIG.realm)}", ` +
    `oauth_consumer_key="${percentEncode(oauthParams.oauth_consumer_key)}", ` +
    `oauth_token="${percentEncode(oauthParams.oauth_token)}", ` +
    `oauth_signature_method="${percentEncode(oauthParams.oauth_signature_method)}", ` +
    `oauth_timestamp="${percentEncode(oauthParams.oauth_timestamp)}", ` +
    `oauth_nonce="${percentEncode(oauthParams.oauth_nonce)}", ` +
    `oauth_version="${percentEncode(oauthParams.oauth_version)}", ` +
    `oauth_signature="${percentEncode(signature)}"`;

  return {
    header: headerValue,
    baseString: signatureBaseString,
    signature,
    timestamp,
    nonce
  };
}

/**
 * Validates an incoming TBA Authorization header.
 */
export function verifyTBAHeader(authHeader, httpMethod, requestUrl) {
  if (!authHeader || !authHeader.startsWith('OAuth ')) {
    return { isValid: false, reason: 'MISSING_OR_INVALID_AUTH_SCHEME' };
  }

  const rawPairs = authHeader.replace(/^OAuth\s+/, '').split(',');
  const params = {};
  for (const pair of rawPairs) {
    const [rawKey, rawVal] = pair.trim().split('=');
    if (rawKey && rawVal) {
      params[rawKey] = decodeURIComponent(rawVal.replace(/^"|"$/g, ''));
    }
  }

  if (params.realm !== TBA_CONFIG.realm) {
    return { isValid: false, reason: 'INVALID_REALM' };
  }
  if (params.oauth_consumer_key !== TBA_CONFIG.consumerKey) {
    return { isValid: false, reason: 'INVALID_CONSUMER_KEY' };
  }
  if (params.oauth_token !== TBA_CONFIG.tokenId) {
    return { isValid: false, reason: 'INVALID_TOKEN_ID' };
  }
  if (params.oauth_signature_method !== 'HMAC-SHA256') {
    return { isValid: false, reason: 'UNSUPPORTED_SIGNATURE_METHOD' };
  }

  return {
    isValid: true,
    clientRealm: params.realm,
    timestamp: params.oauth_timestamp,
    nonce: params.oauth_nonce
  };
}
