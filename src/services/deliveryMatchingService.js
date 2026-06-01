const db = require('../config/db');
const { encodeGeohash, getGeohashNeighbors, getMatchingPrecision } = require('./geohash');

const EARTH_RADIUS_KM = 6371;
const DEFAULT_RADIUS_KM = 5;
const DEFAULT_MAX_LOCATION_AGE_MINUTES = 10;

function buildGeohashPredicates(prefixes) {
  return prefixes
    .map((_, index) => `dp.current_geohash LIKE :geohashPrefix${index}`)
    .join(' OR ');
}

function buildGeohashParams(prefixes) {
  return prefixes.reduce((params, prefix, index) => {
    params[`geohashPrefix${index}`] = `${prefix}%`;
    return params;
  }, {});
}

function haversineDistanceKm(latitudeA, longitudeA, latitudeB, longitudeB) {
  const latitudeDelta = ((latitudeB - latitudeA) * Math.PI) / 180;
  const longitudeDelta = ((longitudeB - longitudeA) * Math.PI) / 180;
  const sourceLatitude = (latitudeA * Math.PI) / 180;
  const targetLatitude = (latitudeB * Math.PI) / 180;

  const a =
    Math.sin(latitudeDelta / 2) * Math.sin(latitudeDelta / 2) +
    Math.cos(sourceLatitude) * Math.cos(targetLatitude) *
      Math.sin(longitudeDelta / 2) * Math.sin(longitudeDelta / 2);

  return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function findNearestAvailablePartners({
  latitude,
  longitude,
  radiusKm = DEFAULT_RADIUS_KM,
  limit = 1,
  maxLocationAgeMinutes = DEFAULT_MAX_LOCATION_AGE_MINUTES,
}) {
  const precision = getMatchingPrecision(radiusKm);
  const searchGeohash = encodeGeohash(latitude, longitude, precision);
  const geohashPrefixes = getGeohashNeighbors(searchGeohash);
  const geohashPredicates = buildGeohashPredicates(geohashPrefixes);

  const sql = `
    SELECT
      dp.*,
      (
        :earthRadius * ACOS(
          LEAST(1, GREATEST(-1,
            COS(RADIANS(:latitude)) * COS(RADIANS(dp.current_latitude)) *
            COS(RADIANS(dp.current_longitude) - RADIANS(:longitude)) +
            SIN(RADIANS(:latitude)) * SIN(RADIANS(dp.current_latitude))
          ))
        )
      ) AS distance_km
    FROM delivery_partners dp
    WHERE dp.status = 'AVAILABLE'
      AND dp.location_updated_at >= DATE_SUB(NOW(), INTERVAL :maxLocationAgeMinutes MINUTE)
      AND (${geohashPredicates})
    HAVING distance_km <= :radiusKm
    ORDER BY distance_km ASC, dp.location_updated_at DESC
    LIMIT :limit
  `;

  const [rows] = await db.query(sql, {
    earthRadius: EARTH_RADIUS_KM,
    latitude,
    longitude,
    radiusKm,
    limit,
    maxLocationAgeMinutes,
    ...buildGeohashParams(geohashPrefixes),
  });

  return {
    search: {
      latitude,
      longitude,
      radiusKm,
      precision,
      geohash: searchGeohash,
      checkedGeohashPrefixes: geohashPrefixes,
      maxLocationAgeMinutes,
    },
    partners: rows,
  };
}

module.exports = {
  DEFAULT_MAX_LOCATION_AGE_MINUTES,
  DEFAULT_RADIUS_KM,
  encodeGeohash,
  findNearestAvailablePartners,
  haversineDistanceKm,
};
