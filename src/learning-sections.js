/* V2.0C「學」頁面資料：沿用既有影片 URL，只整理公開呈現分類。 */
(() => {
  const video = (id, title, youtubeUrl, order) => ({
    id,
    title,
    youtubeUrl,
    order,
    enabled: true,
  });

  window.FdeLearningSections = [
    {
      id: 'closed-flight-control',
      title: '閉源飛控系統',
      label: 'CLOSED FLIGHT CONTROL',
      summary: '從 F450 與 DJI NAZA 組裝，到軟體介紹與地面站設定。',
      courses: [
        video('closed-01', '多旋翼F450&dji naza組裝步驟', 'https://youtu.be/F9RLymjxsVo?si=Bg5pFoD42r84qFCx', 1),
        video('closed-02', '多旋翼F450&djinaza調參軟體介紹', 'https://youtu.be/U3VhDWSoLUE?si=KOWQ5Phg2Rok5oNi', 2),
        video('closed-03', 'dji naza 地面站調參軟體介紹', 'https://youtu.be/XbvoZ9LN1YU?si=ioJW6oYzwWvF3lEn', 3),
      ],
    },
    {
      id: 'open-flight-control',
      title: '開源飛控系統',
      label: 'OPEN FLIGHT CONTROL',
      summary: 'F450＋Pixhawk 2.4.8、Mission Planner 與 AT9S PRO 的完整流程。',
      courses: [
        video('open-01', '多旋翼F450&px2.4.8飛控&mp地面站設置說明', 'https://youtu.be/dWkH5YVi3gY?si=AAcniWN9BjKwF8rL', 1),
        video('open-02', 'MP地面站軟體基礎介紹1', 'https://youtu.be/N0fW9Q9sWMU?si=hpvsR3KT-3eS1-bZ', 2),
        video('open-03', '無人機Mp地面站設定飛行計劃講解', 'https://youtu.be/iqasSBlnyZg?si=U3iOdMhmZC4-ivUQ', 3),
        video('open-04', 'F450无人机 AT9SPRO遥控器调试设置教程', 'https://youtu.be/omPgcb1PFRM?si=aPQ7hetB-99oYGTR', 4),
      ],
    },
    {
      id: 'printing-3d',
      title: '3D 列印學習',
      label: '3D PRINTING',
      summary: '保留教師指定的 Fusion 360 第 01–16 集課程，依原始順序排列。',
      courses: [
        video('printing-01', 'Fusion 360 教程（持续更新中） p01 1  Fusion 360 简介', 'https://youtu.be/krwiLPgX-jc?si=muN0t3CPk6odrwW8', 1),
        video('printing-02', '02 2  安装 Fusion 360', 'https://youtu.be/PbY0kk5_ZgQ?si=tpmJM_OjU3veo0fq', 2),
        video('printing-03', 'fusion360 03 3  用户界面介绍', 'https://youtu.be/eFx4Y32O5ZA?si=9_eSuQrPkJZI1EnT', 3),
        video('printing-04', 'Fusion360 04 4  直线与草图尺寸', 'https://youtu.be/6GTNxyggWKk?si=rd9yDw8FBNJXYwnh', 4),
        video('printing-05', 'Fusion 360 05 5  矩形与圆', 'https://youtu.be/LWRdX7diPsc?si=LnDl_eiAGIJ_4KQv', 5),
        video('printing-06', 'Fusion 360 06 6  圆弧、槽、圆角、点', 'https://youtu.be/nxsu_WuswFI?si=ZbYkzJQJ2e98iylD', 6),
        video('printing-07', 'Fusion 360 07 7  约束', 'https://youtu.be/fvokyfXBk8c?si=G3kdrho1ASoaNzOh', 7),
        video('printing-08', 'Fusion 360 08 8  草图练习1', 'https://youtu.be/5at7lvtZCHs?si=BcrcSxxXQW4VHO_N', 8),
        video('printing-09', 'Fusion 360 09 9  草图练习2', 'https://youtu.be/9yS8o9lLIP4?si=tnd2vLf16S5cDddd', 9),
        video('printing-10', '13 13  实体命令 拉伸', 'https://youtu.be/Q4SCpO1bNSM?si=riI3CLw6bv9U7mY1', 10),
        video('printing-11', 'Fusion 360  11 11  草图练习4 环形阵列与多边形', 'https://youtu.be/QLWScjXtKk0?si=I9ru_J3MmYqqUllt', 11),
        video('printing-12', 'Fusion 360 12 12  草图练习5 进阶', 'https://youtu.be/mLZ0bJi0ARE?si=sSn4W4P1uD-tnNjQ', 12),
        video('printing-13', 'Fusion 360 14 14  实体命令 旋转', 'https://youtu.be/uRv467PhPkU?si=MfaSD8jkDsu_UmL6', 13),
        video('printing-14', 'Fusion 360 15 15  实体命令 扫掠', 'https://youtu.be/fJ2a28FoKWI?si=ine09PVeqe8xJ77L', 14),
        video('printing-15', 'Fusion 360  16 16  构造基准面', 'https://youtu.be/BKHmelBgvkE?si=W43xZ9TytUx7hgCl', 15),
        video('printing-16', 'Fusion 360   17  实体命令 放样、抽壳、圆角', 'https://youtu.be/kAqhQ8hqyLk?si=bMjb80BxpPaFAY6w', 16),
      ],
    },
  ];
})();
