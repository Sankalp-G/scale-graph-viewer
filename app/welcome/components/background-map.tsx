import { useEffect, useState } from "react";
import mapboxgl from 'mapbox-gl';

export default function BackgroundMap() {
  const [map, setMap] = useState<mapboxgl.Map | null>(null);

  useEffect(() => {
    mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_ACCESS_TOKEN;
    const map = new mapboxgl.Map({
	    container: 'map',
	    style: 'mapbox://styles/mapbox/streets-v12',
      center: [77.5997, 12.9747],
      zoom: 13.5,
    });

    map.on('load', () => {
      // map.addSource('banglore_boundary', {
      //     type: 'geojson',
      //     generateId: true,
      //     data: '/banglore_boundary.geojson',
      // });
      //
      // map.addLayer({
      //     id: 'banglore_boundary_layer',
      //     type: 'line',
      //     source: 'banglore_boundary',
      //     paint: {
      //         'line-color': 'cadetblue',
      //         'line-width': 2,
      //     },
      // });
      
      map.addSource('cameras', {
        type: 'geojson',
        generateId: true,
        data: '/sample_camera_edges/cameras.geojson',
      });

      map.addLayer({
        id: 'cameras_layer',
        type: 'circle',
        source: 'cameras',
        paint: {
          'circle-color': 'red',
          'circle-radius': 5,
        },
      });

      map.addSource('edges', {
        type: 'geojson',
        generateId: true,
        data: '/sample_camera_edges/edges.geojson',
      });

      map.addLayer({
        id: 'edges_layer',
        type: 'line',
        source: 'edges',
        paint: {
          'line-color': 'blue',
          'line-width': 2,
        },
      });
    });

    setMap(map);
  }, []);

  console.log(map);

  // print coords
  console.log(map && map.getCenter());

  return (
    <div className="w-screen h-screen absolute top-0 left-0 -z-1">
      <div className="w-full h-full" id="map"></div>
    </div>
  );
}
