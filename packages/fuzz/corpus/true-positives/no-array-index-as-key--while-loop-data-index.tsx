// rule: no-array-index-as-key
// weakness: control-flow
// source: ReactBench fix-react-rdh-pedropalau-react-b

interface Photo {
  photo: string;
}

export const preloadPhotos = (photos: Photo[], activePhotoIndex: number, preloadSize: number) => {
  const nodes = [];
  let loaded = 0;
  let index = activePhotoIndex;
  while (index < photos.length && loaded < preloadSize) {
    const photo = photos[index];
    nodes.push(<img key={index} src={photo.photo} alt="" />);
    index += 1;
    loaded += 1;
  }
  return nodes;
};
