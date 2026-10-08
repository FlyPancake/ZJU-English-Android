param(
    [Parameter(Mandatory=$true)][string]$Source,
    [Parameter(Mandatory=$true)][string]$Destination,
    [string]$LauncherDestination = (Join-Path $PSScriptRoot '..\res\drawable\icon.png')
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
Add-Type -ReferencedAssemblies System.Drawing.Common,System.Drawing.Primitives,System.Private.Windows.GdiPlus,System.Private.Windows.Core,System.Console,System.Runtime -TypeDefinition @'
using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
public static class IconCutout {
    public static void Create(string source, string destination, string launcherDestination) {
        using (Image original = Image.FromFile(source))
        using (Bitmap image = new Bitmap(original.Width, original.Height, PixelFormat.Format32bppArgb)) {
            using (Graphics canvas = Graphics.FromImage(image)) canvas.DrawImage(original, 0, 0, image.Width, image.Height);
            BitmapData data = image.LockBits(new Rectangle(0, 0, image.Width, image.Height), ImageLockMode.ReadWrite, PixelFormat.Format32bppArgb);
            byte[] pixels = new byte[data.Stride * image.Height];
            Marshal.Copy(data.Scan0, pixels, 0, pixels.Length);
            int width = image.Width, height = image.Height;
            bool[] visited = new bool[width * height];
            int[] queue = new int[width * height];
            int tail = 0;
            Action<int, int> enqueue = (horizontal, vertical) => {
                if (horizontal < 0 || horizontal >= width || vertical < 0 || vertical >= height) return;
                int index = vertical * width + horizontal;
                if (visited[index]) return;
                int offset = vertical * data.Stride + horizontal * 4;
                int lowest = Math.Min(pixels[offset], Math.Min(pixels[offset + 1], pixels[offset + 2]));
                int highest = Math.Max(pixels[offset], Math.Max(pixels[offset + 1], pixels[offset + 2]));
                if (lowest < 235 || highest - lowest > 18) return;
                visited[index] = true; queue[tail++] = index;
            };
            for (int horizontal = 0; horizontal < width; horizontal++) { enqueue(horizontal, 0); enqueue(horizontal, height - 1); }
            for (int vertical = 0; vertical < height; vertical++) { enqueue(0, vertical); enqueue(width - 1, vertical); }
            for (int head = 0; head < tail; head++) {
                int index = queue[head], horizontal = index % width, vertical = index / width;
                int offset = vertical * data.Stride + horizontal * 4;
                pixels[offset] = 0; pixels[offset + 1] = 0; pixels[offset + 2] = 0; pixels[offset + 3] = 0;
                enqueue(horizontal - 1, vertical); enqueue(horizontal + 1, vertical);
                enqueue(horizontal, vertical - 1); enqueue(horizontal, vertical + 1);
            }
            Marshal.Copy(pixels, 0, data.Scan0, pixels.Length); image.UnlockBits(data);
            image.Save(destination, ImageFormat.Png);
            using (Bitmap launcher = new Bitmap(192, 192, PixelFormat.Format32bppArgb)) {
                using (Graphics canvas = Graphics.FromImage(launcher)) {
                    canvas.Clear(Color.Transparent);
                    canvas.CompositingMode = System.Drawing.Drawing2D.CompositingMode.SourceCopy;
                    canvas.InterpolationMode = System.Drawing.Drawing2D.InterpolationMode.HighQualityBicubic;
                    canvas.DrawImage(image, new Rectangle(0, 0, 192, 192), 0, 0, width, height, GraphicsUnit.Pixel);
                }
                launcher.Save(launcherDestination, ImageFormat.Png);
            }
            Console.WriteLine("Transparent background pixels: " + tail + "; foreground pixels: " + (width * height - tail));
        }
    }
}
'@
[IconCutout]::Create([IO.Path]::GetFullPath($Source), [IO.Path]::GetFullPath($Destination), [IO.Path]::GetFullPath($LauncherDestination))
