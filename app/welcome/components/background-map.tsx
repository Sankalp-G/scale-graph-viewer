import { useEffect, useState } from "react";
import mapboxgl from 'mapbox-gl';

export default function BackgroundMap() {
  const [map, setMap] = useState<mapboxgl.Map | null>(null);

  useEffect(() => {
    mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_ACCESS_TOKEN;
    const map = new mapboxgl.Map({
	    container: 'map',
	    style: 'mapbox://styles/mapbox/streets-v12',
      center: [78.9629, 23.5937],
      zoom: 4.5,
    });

    setMap(map);
  }, []);

  console.log(map);

  return (
    <div className="w-screen h-screen absolute top-0 left-0 -z-1">
      <div className="w-full h-full" id="map"></div>
    </div>
  );
}
