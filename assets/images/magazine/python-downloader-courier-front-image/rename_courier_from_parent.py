#!/usr/bin/env python3
"""
rename_courier_from_parent.py

Local do script: <script_dir>
Diretório de imagens esperado: <script_dir>/..   (um nível acima)

O script:
 - lê a lista fixa de datas incorporada (sua lista de 103 entradas),
 - identifica e ordena imagens em images_dir,
 - mapeia imagens (mais antiga -> primeira data mais antiga) e renomeia
   para courier-<YYYY>-<imgMon>.jpg (imgMon: 01,03,05,07,09,11).

Uso:
    python rename_courier_from_parent.py [--images-dir PATH] [--dry-run] [--overwrite] [--convert]

--images-dir : se quiser especificar diretório diferente do ../
--dry-run    : só mostra ações sem renomear
--overwrite  : sobrescrever destino se já existir
--convert    : converte imagens (PNG/JPEG) para JPEG real usando Pillow (requer Pillow instalado)
"""
from pathlib import Path
import re
import argparse
import sys
import os
from datetime import datetime
import shutil

# ---------------------------
# Lista de datas fornecida (copiada exatamente como no seu último post)
# ---------------------------
DATES_RAW = """Jan/Feb 2026
Nov/Dec 2025
Sep/Oct 2025
Jul/Aug 2025
May/Jun 2025
Mar/Apr 2025
Jan/Feb 2025
Nov/Dec 2024
Sep/Oct 2024
Jul/Aug 2024
May/Jun 2024
Mar/Apr 2024
Jan/Feb 2024
Nov/Dec 2023
Sep/Oct 2023
Jul/Aug 2023
May/Jun 2023
Mar/Apr 2023
Jan/Feb 2023
Nov/Dec 2022
Sep/Oct 2022
Jul/Aug 2022
May/Jun 2022
Mar/Apr 2022
Jan/Feb 2022
Nov/Dec 2021
Sep/Oct 2021
Jul/Aug 2021
May/Jun 2021
Mar/Apr 2021
Jan/Feb 2021
Nov/Dec 2020
Sep/Oct 2020
Jul/Aug 2020
May/Jun 2020
Mar/Apr 2020
Jan/Feb 2020
Nov/Dec 2019
Sep/Oct 2019
Jul/Aug 2019
May/Jun 2019
Mar/Apr 2019
CERN Courier Jan/Feb 2019
Jan/Feb 2019
Dec 2018
Nov 2018
Oct 2018
Sep 2018
Jul/Aug 2018
Jun 2018
May 2018
Apr 2018
Mar 2018
Jan/Feb 2018
Dec 2017
Nov 2017
Oct 2017
Sep 2017
Jul/Aug 2017
Jun 2017
May 2017
Apr 2017
Mar 2017
Jan/Feb 2017
Dec 2016
Nov 2016
Oct 2016
Sep 2016
Jul/Aug 2016
Jun 2016
May 2016
Apr 2016
Mar 2016
Jan/Feb 2016
Dec 2015
Nov 2015
Oct 2015
Sep 2015
Jul/Aug 2015
Jun 2015
May 2015
Apr 2015
Mar 2015
Jan/Feb 2015
Dec 2014
Nov 2014
Oct 2014
Sep 2014
Jul/Aug 2014
Jun 2014
May 2014
Apr 2014
Mar 2014
Jan/Feb 2014
Dec 2013
Nov 2013
Oct 2013
Sep 2013
Jul/Aug 2013
Jun 2013
May 2013
Apr 2013
Mar 2013
Jan/Feb 2013
"""

# ---------------------------
# Helpers e padrões
# ---------------------------
BIMONTHLY_MAP = {
    "jan/feb": "01",
    "mar/apr": "03",
    "may/jun": "05",
    "jul/aug": "07",
    "sep/oct": "09",
    "nov/dec": "11",
}
MONTH_NAME_TO_NUM = {
    "jan": 1, "feb": 2, "mar": 3, "apr": 4, "may": 5, "jun": 6,
    "jul": 7, "aug": 8, "sep": 9, "sept": 9, "oct": 10, "nov": 11, "dec": 12
}

RE_YEAR_4 = re.compile(r'(20(1[3-9]|2[0-9]))')   # 2013..2029
RE_YEAR_2 = re.compile(r'\b(1[3-9]|2[0-6])\b')   # 13..26
RE_BIMONTH = re.compile(r'\b(jan\/feb|mar\/apr|may\/jun|jul\/aug|sep\/oct|nov\/dec)\b', re.IGNORECASE)
RE_MONTH_NAME = re.compile(r'\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)\b', re.IGNORECASE)

# filename hints
RE_FILENAME_YEAR_4 = re.compile(r'20(1[3-9]|2[0-9])')  # 2013..2029
RE_FILENAME_YEAR_2 = re.compile(r'\b(1[3-9]|2[0-6])\b')
RE_FILENAME_BIMONTH = RE_BIMONTH
RE_FILENAME_MONTH = RE_MONTH_NAME

VALID_EXT = {".png", ".jpg", ".jpeg"}

# ---------------------------
# Funções
# ---------------------------
def parse_date_line(line: str):
    s = line.strip()
    if not s:
        return None
    # ano preferido 4 dígitos
    m4 = RE_YEAR_4.search(s)
    if m4:
        year = int(m4.group(1))
    else:
        m2 = RE_YEAR_2.search(s)
        if m2:
            year = 2000 + int(m2.group(1))
        else:
            # fallback: procurar qualquer 4 dígitos
            m_any4 = re.search(r'(\d{4})', s)
            if m_any4:
                year = int(m_any4.group(1))
            else:
                raise ValueError(f"A linha de datas não tem ano reconhecível: '{s}'")

    # bimês token
    bm = RE_BIMONTH.search(s)
    if bm:
        token = bm.group(1).lower()
        imgMon = BIMONTHLY_MAP[token]
        return (year, imgMon, s)

    # procurar mês único
    mn = RE_MONTH_NAME.search(s)
    if mn:
        month_num = MONTH_NAME_TO_NUM.get(mn.group(1).lower())
        if month_num is None:
            raise ValueError(f"Mês não reconhecido: '{s}'")
        # se mês for par, usar anterior; se ímpar, usar ele mesmo
        if month_num % 2 == 0:
            month_bi = month_num - 1
        else:
            month_bi = month_num
        if month_bi <= 0:
            month_bi = 1
        imgMon = f"{month_bi:02d}"
        # garantir que é um dos permitidos (01,03,05,07,09,11)
        if imgMon not in {"01","03","05","07","09","11"}:
            # ajuste por segurança
            if month_bi > 11:
                imgMon = "11"
            else:
                imgMon = "01"
        return (year, imgMon, s)

    # fallback conservador
    return (year, "01", s)

def parse_all_dates(dates_raw: str):
    lines = [l.strip() for l in dates_raw.splitlines() if l.strip()]
    parsed = []
    for idx, line in enumerate(lines):
        parsed.append((parse_date_line(line)[0], parse_date_line(line)[1], line, idx))
    # ordenar cronologicamente (mais antigo -> mais novo)
    parsed_sorted = sorted(parsed, key=lambda x: (x[0], int(x[1]), x[3]))
    return parsed_sorted  # list of tuples (year,imgMon,raw,orig_index)

def extract_year_month_from_filename(name: str):
    # tenta extrair ano e mês do nome do ficheiro
    m4 = RE_FILENAME_YEAR_4.search(name)
    if m4:
        year = int(m4.group(0))
    else:
        m2 = RE_FILENAME_YEAR_2.search(name)
        year = 2000 + int(m2.group(1)) if m2 else None

    bm = RE_FILENAME_BIMONTH.search(name)
    if bm:
        imgMon = BIMONTHLY_MAP[bm.group(1).lower()]
        return year, imgMon

    mn = RE_FILENAME_MONTH.search(name)
    if mn:
        month_num = MONTH_NAME_TO_NUM.get(mn.group(1).lower())
        if month_num:
            if month_num % 2 == 0:
                month_bi = month_num - 1
            else:
                month_bi = month_num
            imgMon = f"{month_bi:02d}"
            if imgMon not in {"01","03","05","07","09","11"}:
                imgMon = "01"
            return year, imgMon
    return year, None

def gather_images(images_dir: Path):
    imgs = []
    for p in images_dir.iterdir():
        if not p.is_file():
            continue
        if p.suffix.lower() in VALID_EXT:
            imgs.append(p)
    return imgs

def sort_images(img_paths):
    infos = []
    for p in img_paths:
        name = p.name
        year_hint, imgMon_hint = extract_year_month_from_filename(name)
        mtime = p.stat().st_mtime
        year_key = year_hint if year_hint is not None else 9999
        month_key = int(imgMon_hint) if imgMon_hint is not None else 99
        infos.append((p, year_key, month_key, mtime))
    infos_sorted = sorted(infos, key=lambda x: (x[1], x[2], x[3]))
    return [t[0] for t in infos_sorted]

def ensure_unique_target(images_dir: Path, target_name: str, overwrite: bool):
    target = images_dir / target_name
    if not target.exists() or overwrite:
        return target
    # acrescenta sufixo incremental
    base = target.stem
    ext = target.suffix
    i = 1
    while True:
        candidate = images_dir / f"{base}_{i}{ext}"
        if not candidate.exists():
            return candidate
        i += 1

def convert_to_jpeg(src_path: Path, dst_path: Path):
    # usa Pillow se disponível
    try:
        from PIL import Image
    except Exception as e:
        raise RuntimeError("Pillow não está instalado. Instale com: python -m pip install Pillow") from e
    im = Image.open(src_path)
    # converter para RGB (PNG pode ter alpha)
    if im.mode in ("RGBA", "LA") or (im.mode == "P"):
        im = im.convert("RGB")
    im.save(dst_path, format="JPEG", quality=95)

# ---------------------------
# Main
# ---------------------------
def main():
    ap = argparse.ArgumentParser(description="Renomeia imagens do diretório pai do script seguindo sua lista de datas.")
    ap.add_argument("--images-dir", type=str, default=None, help="Diretório com imagens. Se ausente, usa o diretório pai do script.")
    ap.add_argument("--dry-run", action="store_true", help="Não aplica alterações; só mostra o que seria feito.")
    ap.add_argument("--overwrite", action="store_true", help="Sobrescrever destino se já existir.")
    ap.add_argument("--convert", action="store_true", help="Converter imagens para JPEG real (requer Pillow).")
    args = ap.parse_args()

    script_dir = Path(__file__).resolve().parent
    images_dir = Path(args.images_dir).resolve() if args.images_dir else script_dir.parent.resolve()

    if not images_dir.exists() or not images_dir.is_dir():
        print(f"Diretório de imagens não encontrado: {images_dir}", file=sys.stderr)
        sys.exit(1)

    parsed_dates = parse_all_dates(DATES_RAW)   # list of (year,imgMon,raw,orig_idx)
    total_dates = len(parsed_dates)

    imgs = gather_images(images_dir)
    if not imgs:
        print(f"Nenhuma imagem encontrada em {images_dir} com extensões {VALID_EXT}", file=sys.stderr)
        sys.exit(1)

    imgs_sorted = sort_images(imgs)
    total_imgs = len(imgs_sorted)

    if total_imgs != total_dates:
        print(f"Atenção: {total_imgs} imagens encontradas, mas {total_dates} datas na lista.")
        n_map = min(total_imgs, total_dates)
        print(f"Serão renomeadas as primeiras {n_map} imagens (mais antiga -> mais nova).")
    else:
        n_map = total_imgs

    # criar ações de renomeação
    actions = []
    for i in range(n_map):
        src = imgs_sorted[i]
        year, imgMon, raw, orig_idx = parsed_dates[i]
        target_name = f"courier-{year}-{imgMon}.jpg"
        target_path = images_dir / target_name
        final_target = ensure_unique_target(images_dir, target_name, args.overwrite)
        actions.append((src, final_target, year, imgMon, raw))

    # mostrar e executar
    print(f"\nExecutando renomeação em {images_dir} (dry-run={args.dry_run}, overwrite={args.overwrite}, convert={args.convert})\n")
    for src, dst, year, imgMon, raw in actions:
        note = ""
        # se a extensão do src não for .jpg/.jpeg e destino é .jpg -> se convert flag off, apenas renomeamos (conteúdo permanece)
        if src.suffix.lower() in {".png"} and dst.suffix.lower() == ".jpg" and not args.convert:
            note = " (nota: arquivo PNG renomeado para .jpg sem conversão do conteúdo)"
        print(f"{src.name}  ->  {dst.name}    [{year} {imgMon}]    origem_info: {raw}{note}")
        if not args.dry_run:
            try:
                # se convert solicitado: criar JPEG real
                if args.convert:
                    # dst pode ter sufixo que garanta unicidade
                    convert_to_jpeg(src, dst)
                    # remover arquivo original se desejar; aqui mantemos original (poderia optar por remover)
                    # removemos original para deixar apenas o novo (comportamento comum)
                    src.unlink()
                else:
                    # renomear (pode mudar só o nome/ extensão)
                    src.rename(dst)
            except Exception as e:
                print(f"ERRO ao processar {src}: {e}", file=sys.stderr)

    print("\nResumo:")
    print(f"  imagens encontradas: {total_imgs}")
    print(f"  datas fornecidas:    {total_dates}")
    print(f"  renomeadas:         {n_map}")
    if args.dry_run:
        print("  (dry-run) Nenhuma alteração foi realizada.")

if __name__ == "__main__":
    main()