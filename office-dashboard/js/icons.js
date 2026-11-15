// Stroke icons on a 24x24 grid; weather set based on dashboard/js/icons.js.
const PATHS = {
  sun: '<circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M5.3 18.7l1.6-1.6M17.1 6.9l1.6-1.6"/>',
  moon: '<path d="M20 14.5A8.2 8.2 0 0 1 9.5 4 8.2 8.2 0 1 0 20 14.5z"/>',
  partly: '<path d="M8.5 2.5v1.3M3.4 4.6l.9.9M1.8 9.6h1.3M13.6 4.6l-.9.9"/><path d="M5.3 12.3a4 4 0 0 1 6.9-4.4"/><path d="M9.5 20h8.3a3.6 3.6 0 0 0 .3-7.2 5.2 5.2 0 0 0-9.9 1.4A2.9 2.9 0 0 0 9.5 20z"/>',
  partlyNight: '<path d="M11.5 7.8A4.4 4.4 0 0 1 5 12.6 4.4 4.4 0 1 0 11.5 7.8z"/><path d="M9.5 20h8.3a3.6 3.6 0 0 0 .3-7.2 5.2 5.2 0 0 0-9.9 1.4A2.9 2.9 0 0 0 9.5 20z"/>',
  cloud: '<path d="M7 18.5h10.2a4.3 4.3 0 0 0 .4-8.6A6.2 6.2 0 0 0 5.8 11.6 3.5 3.5 0 0 0 7 18.5z"/>',
  fog: '<path d="M7 13h10.2a4.3 4.3 0 0 0 .4-8.6A6.2 6.2 0 0 0 5.8 6.1 3.5 3.5 0 0 0 7 13z"/><path d="M4 17h16M6 20.5h12"/>',
  rain: '<path d="M7 15h10.2a4.3 4.3 0 0 0 .4-8.6A6.2 6.2 0 0 0 5.8 8.1 3.5 3.5 0 0 0 7 15z"/><path d="M8.5 18l-1 3M12.5 18l-1 3M16.5 18l-1 3"/>',
  snow: '<path d="M7 15h10.2a4.3 4.3 0 0 0 .4-8.6A6.2 6.2 0 0 0 5.8 8.1 3.5 3.5 0 0 0 7 15z"/><path d="M8 18.5v.01M12 20.5v.01M16 18.5v.01M10 21.5v.01M14 21.5v.01" stroke-width="2.6"/>',
  storm: '<path d="M7 15h10.2a4.3 4.3 0 0 0 .4-8.6A6.2 6.2 0 0 0 5.8 8.1 3.5 3.5 0 0 0 7 15z"/><path d="M12.5 15l-2 3.5h3l-2 3.5"/>',
};

export function icon(name, size) {
  return `<svg class="i" width="${size}" height="${size}" viewBox="0 0 24 24">${PATHS[name] || PATHS.cloud}</svg>`;
}

// WMO weather codes (Open-Meteo) to an icon and a short label.
export function weatherInfo(code, isDay) {
  const day = isDay !== 0;
  if (code === 0) return { icon: day ? 'sun' : 'moon', label: 'Clear' };
  if (code === 1) return { icon: day ? 'sun' : 'moon', label: 'Mostly clear' };
  if (code === 2) return { icon: day ? 'partly' : 'partlyNight', label: 'Partly cloudy' };
  if (code === 3) return { icon: 'cloud', label: 'Overcast' };
  if (code === 45 || code === 48) return { icon: 'fog', label: 'Fog' };
  if (code >= 51 && code <= 57) return { icon: 'rain', label: 'Drizzle' };
  if (code >= 61 && code <= 67) return { icon: 'rain', label: code >= 66 ? 'Freezing rain' : 'Rain' };
  if (code >= 71 && code <= 77) return { icon: 'snow', label: 'Snow' };
  if (code >= 80 && code <= 82) return { icon: 'rain', label: 'Showers' };
  if (code === 85 || code === 86) return { icon: 'snow', label: 'Snow showers' };
  if (code >= 95) return { icon: 'storm', label: 'Thunderstorm' };
  return { icon: 'cloud', label: 'Cloudy' };
}
