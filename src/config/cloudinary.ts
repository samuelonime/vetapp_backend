import { v2 as cloudinary } from "cloudinary";

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME as string,
  api_key: process.env.CLOUDINARY_API_KEY as string,
  api_secret: process.env.CLOUDINARY_API_SECRET as string,
});

if (
  !process.env.CLOUDINARY_CLOUD_NAME ||
  !process.env.CLOUDINARY_API_KEY ||
  !process.env.CLOUDINARY_API_SECRET
) {
  throw new Error("Cloudinary environment variables are missing");
}

export const uploadImage = async (filePath: string) => {
  return await cloudinary.uploader.upload(filePath, {
    folder: "vet_app_uploads",
  });
};

export const deleteImage = async (publicId: string) => {
  return await cloudinary.uploader.destroy(publicId);
};

export default cloudinary;
