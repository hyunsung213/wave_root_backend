const SITE_CODES = Object.freeze({
  HYDROPONIC: 'HYDROPONIC',
  Y_FARM: 'Y_FARM'
});
const Y_FARM_NOZZLES = Object.freeze([1, 3, 4, 5, 6, 7, 8, 9]);

const FARM_SITES = Object.freeze([
  Object.freeze({
    code: SITE_CODES.HYDROPONIC,
    name: '수경재배',
    streamingGateway: 'RDK_X5',
    capabilities: Object.freeze({ streaming: true, irrigation: false })
  }),
  Object.freeze({
    code: SITE_CODES.Y_FARM,
    name: 'Y-Farm',
    streamingGateway: 'RASPBERRY_PI',
    capabilities: Object.freeze({ streaming: true, irrigation: true })
  })
]);

function isSiteCode(value) {
  return Object.values(SITE_CODES).includes(value);
}

function getSite(siteCode) {
  return FARM_SITES.find((site) => site.code === siteCode) || null;
}

module.exports = { SITE_CODES, Y_FARM_NOZZLES, FARM_SITES, isSiteCode, getSite };
