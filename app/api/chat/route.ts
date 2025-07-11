import { streamText } from 'ai';
import { xai } from '@ai-sdk/xai';
import axios from 'axios';

export async function POST(req: Request) {
  const { prompt } = await req.json();
  // Parse input with Grok
  const { text: parsedData } = await streamText({
    model: xai('grok-3'),
    system: 'You are a travel planner. Parse the user input to extract: city, destinations/activities, and time constraints. Return a JSON object with city, destinations (array), and endTime.',
    prompt,
    deepSearch: true,
  });

  const { city, destinations, endTime } = JSON.parse(parsedData);

  // Fetch coordinates and details using Nominatim and Overpass API
  const destinationDetails = await Promise.all(
    destinations.map(async (dest: string) => {
      // Overpass API for POIs
      const overpassQuery = `[out:json];node["tourism"~"attraction|museum"]["name"~"${dest}",i](around:10000,${city});out;`;
      const overpassResponse = await axios.get('http://overpass-api.de/api/interpreter', {
        params: { data: overpassQuery },
      });
      const poi = overpassResponse.data.elements[0] || { tags: { name: dest } };

      // Nominatim for coordinates
      const nominatimResponse = await axios.get('https://nominatim.openstreetmap.org/search', {
        params: { q: `${poi.tags.name}, ${city}`, format: 'json', limit: 1 },
        headers: { 'User-Agent': 'DayTripApp/1.0' },
      });
      const coordinates = nominatimResponse.data[0] ? { lat: parseFloat(nominatimResponse.data[0].lat), lng: parseFloat(nominatimResponse.data[0].lon) } : {};

      // Open-Meteo for weather
      const weatherResponse = await axios.get('https://api.open-meteo.com/v1/forecast', {
        params: { latitude: coordinates.lat, longitude: coordinates.lng, current_weather: true },
      });
      const weather = weatherResponse.data.current_weather?.weathercode || 'Unknown';

      return { name: poi.tags.name || dest, address: poi.tags.address || 'Unknown', coordinates, weather };
    })
  );

  // OSRM for routing
  const coordinatesString = destinationDetails.map(d => `${d.coordinates.lng},${d.coordinates.lat}`).join(';');
  const osrmResponse = await axios.get(`http://router.project-osrm.org/route/v1/driving/${coordinatesString}`, {
    params: { overview: 'full', steps: true },
  });
  const route = osrmResponse.data.routes[0];
  const itinerary = {
    city,
    destinations: destinationDetails,
    timeline: route.legs.map((leg: any, i: number) => ({
      destination: destinationDetails[i + 1]?.name || 'Return',
      transitTime: `${Math.round(leg.duration / 60)} minutes`,
      dwellTime: '1 hour', // Placeholder, adjustable
      weather: destinationDetails[i + 1]?.weather || 'Unknown',
    })),
    totalDistance: (route.distance / 1000).toFixed(2), // km
    endTime,
  };

  return Response.json(itinerary);
}