import { Observe } from "expo-observe";

// Override any persisted consent before the rest of the app loads.
Observe.configure({ dispatchingEnabled: false });
