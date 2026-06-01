const BASE32 = '0123456789bcdefghjkmnpqrstuvwxyz';
const BASE32_INDEXES = new Map(BASE32.split('').map((char, index) => [char, index]));

function validateCoordinates(latitude, longitude) {
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
    throw new Error('latitude must be between -90 and 90');
  }
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    throw new Error('longitude must be between -180 and 180');
  }
}

function normalizeLongitude(longitude) {
  if (longitude > 180) {
    return longitude - 360;
  }
  if (longitude < -180) {
    return longitude + 360;
  }
  return longitude;
}

function encodeGeohash(latitude, longitude, precision = 7) {
  validateCoordinates(latitude, longitude);

  let evenBit = true;
  let bit = 0;
  let charIndex = 0;
  let geohash = '';
  const latitudeRange = [-90, 90];
  const longitudeRange = [-180, 180];

  while (geohash.length < precision) {
    const range = evenBit ? longitudeRange : latitudeRange;
    const midpoint = (range[0] + range[1]) / 2;
    const coordinate = evenBit ? longitude : latitude;

    if (coordinate >= midpoint) {
      charIndex = (charIndex << 1) + 1;
      range[0] = midpoint;
    } else {
      charIndex <<= 1;
      range[1] = midpoint;
    }

    evenBit = !evenBit;
    if (++bit === 5) {
      geohash += BASE32[charIndex];
      bit = 0;
      charIndex = 0;
    }
  }

  return geohash;
}

function decodeGeohashBounds(geohash) {
  if (!geohash || typeof geohash !== 'string') {
    throw new Error('geohash is required');
  }

  let evenBit = true;
  const latitudeRange = [-90, 90];
  const longitudeRange = [-180, 180];

  geohash.toLowerCase().split('').forEach((char) => {
    const charIndex = BASE32_INDEXES.get(char);
    if (charIndex === undefined) {
      throw new Error(`Invalid geohash character: ${char}`);
    }

    for (let mask = 16; mask > 0; mask >>= 1) {
      const range = evenBit ? longitudeRange : latitudeRange;
      const midpoint = (range[0] + range[1]) / 2;

      if (charIndex & mask) {
        range[0] = midpoint;
      } else {
        range[1] = midpoint;
      }

      evenBit = !evenBit;
    }
  });

  return {
    minLatitude: latitudeRange[0],
    maxLatitude: latitudeRange[1],
    minLongitude: longitudeRange[0],
    maxLongitude: longitudeRange[1],
    latitude: (latitudeRange[0] + latitudeRange[1]) / 2,
    longitude: (longitudeRange[0] + longitudeRange[1]) / 2,
    latitudeSpan: latitudeRange[1] - latitudeRange[0],
    longitudeSpan: longitudeRange[1] - longitudeRange[0],
  };
}

function getGeohashNeighbors(geohash) {
  const bounds = decodeGeohashBounds(geohash);
  const neighbors = new Set([geohash]);
  const latitudeOffsets = [-bounds.latitudeSpan, 0, bounds.latitudeSpan];
  const longitudeOffsets = [-bounds.longitudeSpan, 0, bounds.longitudeSpan];

  latitudeOffsets.forEach((latitudeOffset) => {
    longitudeOffsets.forEach((longitudeOffset) => {
      const latitude = Math.max(-90, Math.min(90, bounds.latitude + latitudeOffset));
      const longitude = normalizeLongitude(bounds.longitude + longitudeOffset);
      neighbors.add(encodeGeohash(latitude, longitude, geohash.length));
    });
  });

  return Array.from(neighbors);
}

function getMatchingPrecision(radiusKm) {
  if (radiusKm <= 1) {
    return 6;
  }
  if (radiusKm <= 5) {
    return 5;
  }
  if (radiusKm <= 20) {
    return 4;
  }
  return 3;
}

module.exports = {
  encodeGeohash,
  decodeGeohashBounds,
  getGeohashNeighbors,
  getMatchingPrecision,
};
