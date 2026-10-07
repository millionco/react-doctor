import { AsyncStorage, WebView } from "react-native";
export const Browser = () => <WebView />;
export const load = () => AsyncStorage.getItem("session");
