import axios from "axios";
export async function send(endpoint, body) {
  const response = await axios.post(endpoint, body);
  return response.data;
}
