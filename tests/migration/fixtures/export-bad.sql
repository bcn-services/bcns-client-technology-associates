USE [TechAssoc]
GO
SET ANSI_NULLS ON
GO
INSERT [dbo].[tblstates] ([state]) VALUES (N'NJ')
INSERT [dbo].[tblstates] ([state]) VALUES (N'NY')
GO
INSERT [dbo].[tblActive] ([id], [label]) VALUES (1, N'a legacy table that never made it into the 20')
INSERT [dbo].[tblActive] ([id], [label]) VALUES (2, N'second skipped row')
GO
SET IDENTITY_INSERT [dbo].[tblbillingnames] ON
INSERT [dbo].[tblbillingnames] ([personid], [initials], [billingfactor]) VALUES (11, N'AA', CAST(1.000 AS Decimal(8, 3)))
INSERT [dbo].[tblbillingnames] ([personid], [initials], [billingfactor]) VALUES (40000, N'ZZ', CAST(1.000 AS Decimal(8, 3)))
SET IDENTITY_INSERT [dbo].[tblbillingnames] OFF
GO
INSERT [dbo].[tblbranches] ([branch]) VALUES (N'Newark')
GO
