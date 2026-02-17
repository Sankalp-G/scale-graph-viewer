import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
	index("routes/home.tsx"),
	route("app", "routes/app.tsx"),
	route("app/nowcasting", "routes/app.nowcasting.tsx"),
	route("app/forecast", "routes/app.forecast.tsx"),
	route("app/forecast-streaming", "routes/app.forecast-streaming.tsx"),
	route("app/sample", "routes/app.sample.tsx"),
] satisfies RouteConfig;
