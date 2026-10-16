/**
 * Writes a minimal ASCII FBX 7.4 file: one cube mesh, one Phong material, one
 * texture reference. Enough to exercise FBXLoader-based conversion in tests
 * without committing third-party binaries.
 */
export function asciiFbxCube(textureFile = "crate_diffuse.png"): Uint8Array {
  const v = [-0.5, 0, -0.5, 0.5, 0, -0.5, 0.5, 1, -0.5, -0.5, 1, -0.5, -0.5, 0, 0.5, 0.5, 0, 0.5, 0.5, 1, 0.5, -0.5, 1, 0.5];
  // Quads; the last index of each polygon is stored as -(i+1).
  const faces = [
    [0, 3, 2, 1],
    [4, 5, 6, 7],
    [0, 1, 5, 4],
    [2, 3, 7, 6],
    [1, 2, 6, 5],
    [0, 4, 7, 3],
  ];
  const pvi = faces.flatMap((f) => [f[0], f[1], f[2], -(f[3]! + 1)]);
  const uvs = faces.flatMap(() => [0, 0, 1, 0, 1, 1, 0, 1]);
  const uvIndex = faces.flatMap((_, i) => [i * 4, i * 4 + 1, i * 4 + 2, i * 4 + 3]);
  const arr = (name: string, values: number[]) => `\t\t${name}: *${values.length} {\n\t\t\ta: ${values.join(",")}\n\t\t}`;
  const text = `; FBX 7.4.0 project file
FBXHeaderExtension:  {
	FBXHeaderVersion: 1003
	FBXVersion: 7400
	Creator: "LOWPO11Y test fixture"
}
GlobalSettings:  {
	Version: 1000
	Properties70:  {
		P: "UpAxis", "int", "Integer", "",1
		P: "UpAxisSign", "int", "Integer", "",1
		P: "FrontAxis", "int", "Integer", "",2
		P: "FrontAxisSign", "int", "Integer", "",1
		P: "CoordAxis", "int", "Integer", "",0
		P: "CoordAxisSign", "int", "Integer", "",1
		P: "UnitScaleFactor", "double", "Number", "",1
	}
}
Objects:  {
	Geometry: 1000, "Geometry::Cube", "Mesh" {
${arr("Vertices", v)}
${arr("PolygonVertexIndex", pvi)}
		GeometryVersion: 124
		LayerElementUV: 0 {
			Version: 101
			Name: "UVMap"
			MappingInformationType: "ByPolygonVertex"
			ReferenceInformationType: "IndexToDirect"
${arr("UV", uvs).replace(/\t\t/g, "\t\t\t")}
${arr("UVIndex", uvIndex).replace(/\t\t/g, "\t\t\t")}
		}
		LayerElementMaterial: 0 {
			Version: 101
			Name: ""
			MappingInformationType: "AllSame"
			ReferenceInformationType: "IndexToDirect"
			Materials: *1 {
				a: 0
			}
		}
		Layer: 0 {
			Version: 100
			LayerElement:  {
				Type: "LayerElementUV"
				TypedIndex: 0
			}
			LayerElement:  {
				Type: "LayerElementMaterial"
				TypedIndex: 0
			}
		}
	}
	Model: 2000, "Model::Crate", "Mesh" {
		Version: 232
		Properties70:  {
			P: "Lcl Translation", "Lcl Translation", "", "A",0,0,0
		}
	}
	Material: 3000, "Material::CrateMat", "" {
		Version: 102
		ShadingModel: "phong"
		Properties70:  {
			P: "DiffuseColor", "Color", "", "A",0.8,0.8,0.8
		}
	}
	Texture: 4000, "Texture::CrateTex", "" {
		Type: "TextureVideoClip"
		Version: 202
		TextureName: "Texture::CrateTex"
		FileName: "${textureFile}"
		RelativeFilename: "${textureFile}"
	}
	Video: 5000, "Video::CrateTex", "Clip" {
		Type: "Clip"
		FileName: "C:/Users/someone/textures/${textureFile}"
		RelativeFilename: "textures\\${textureFile}"
	}
}
Connections:  {
	C: "OO",2000,0
	C: "OO",1000,2000
	C: "OO",3000,2000
	C: "OP",4000,3000, "DiffuseColor"
	C: "OO",5000,4000
}
`;
  return new TextEncoder().encode(text);
}
